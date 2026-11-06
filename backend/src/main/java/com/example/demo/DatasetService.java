package com.example.demo;

import java.io.InputStream;
import java.io.IOException;
import java.security.MessageDigest;
import java.time.Instant;
import java.util.Comparator;
import java.util.List;
import java.util.UUID;

import jakarta.annotation.PostConstruct;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.core.io.ClassPathResource;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;
import org.springframework.web.multipart.MultipartFile;

/** Business ownership is separate from Orthanc's global DICOM hierarchy. */
@Service
public class DatasetService {
    public record DatasetItem(String id, String name, String access, String ownerUsername,
                              long instanceCount, String createdAt, boolean canDelete) { }
    public record ShareItem(String subject, String username) { }
    public record ForwardResult(boolean success, String recipientDatasetId, boolean alreadyOwned) { }
    public record TeamDatasetItem(String id, String name, String access, String ownerUsername,
                                  long instanceCount, String createdAt, String scope, String teamId,
                                  String uploaderSubject, boolean canDelete) { }
    private record StoredDataset(String id, String name, boolean publicDataset,
                                 String ownerIssuer, String ownerSubject, String ownerUsername, String createdAt) { }
    private static final String PERSONAL = "NOT EXISTS (SELECT 1 FROM dataset_teams dt WHERE dt.dataset_id=d.id)";
    static final String VISIBLE = "(d.deleted_at IS NULL AND ((" + PERSONAL + " AND (d.is_public = TRUE OR (d.owner_issuer = ? AND d.owner_subject = ?) "
            + ")) "
            + "OR EXISTS (SELECT 1 FROM dataset_teams dt JOIN team_members m ON m.team_id=dt.team_id "
            + "WHERE dt.dataset_id=d.id AND m.user_issuer=? AND m.user_subject=?)))";
    private static final RowMapper<StoredDataset> DATASET = (r, n) -> new StoredDataset(r.getString("id"),
            r.getString("name"), r.getBoolean("is_public"), r.getString("owner_issuer"),
            r.getString("owner_subject"), r.getString("owner_username"), r.getString("created_at"));
    private final JdbcTemplate db;
    private final TransactionTemplate transaction;
    private final OrthancService orthanc;
    private final KeycloakDirectoryService directory;
    private final TeamService teams;
    private final String issuer;
    private final boolean seedEnabled;
    private final ImportLimits importLimits;
    private final SegmentationStorageGuard storage;

    public DatasetService(JdbcTemplate db, PlatformTransactionManager manager, OrthancService orthanc,
            KeycloakDirectoryService directory, TeamService teams, @Value("${keycloak.issuer-uri}") String issuer,
            @Value("${app.datasets.seed-enabled:true}") boolean seedEnabled, ImportLimits importLimits,
            SegmentationStorageGuard storage) {
        this.db = db;
        this.transaction = new TransactionTemplate(manager);
        this.orthanc = orthanc;
        this.directory = directory;
        this.teams = teams;
        this.issuer = issuer;
        this.seedEnabled = seedEnabled;
        this.importLimits = importLimits;
        this.storage = storage;
    }

    @PostConstruct
    void initialize() {
        db.execute("CREATE TABLE IF NOT EXISTS datasets (id VARCHAR(100) PRIMARY KEY, name VARCHAR(200) NOT NULL, "
                + "is_public BOOLEAN NOT NULL, owner_issuer VARCHAR(600), owner_subject VARCHAR(200), "
                + "owner_username VARCHAR(200), created_at VARCHAR(40) NOT NULL)");
        db.execute("CREATE TABLE IF NOT EXISTS dataset_instances (dataset_id VARCHAR(100) NOT NULL REFERENCES datasets(id), "
                + "instance_id VARCHAR(100) NOT NULL, instance_number VARCHAR(100) NOT NULL, PRIMARY KEY(dataset_id, instance_id))");
        db.execute("CREATE INDEX IF NOT EXISTS dataset_instance_lookup ON dataset_instances(instance_id)");
        db.execute("CREATE TABLE IF NOT EXISTS dataset_grants (dataset_id VARCHAR(100) NOT NULL REFERENCES datasets(id), "
                + "user_issuer VARCHAR(600) NOT NULL, user_subject VARCHAR(200) NOT NULL, username VARCHAR(200) NOT NULL, "
                + "PRIMARY KEY(dataset_id, user_issuer, user_subject))");
        db.execute("CREATE INDEX IF NOT EXISTS dataset_grant_lookup ON dataset_grants(user_issuer, user_subject)");
        db.execute("CREATE TABLE IF NOT EXISTS dataset_migrations (id VARCHAR(100) PRIMARY KEY, applied_at VARCHAR(40) NOT NULL)");
        db.execute("ALTER TABLE datasets ADD COLUMN IF NOT EXISTS deleted_at VARCHAR(40)");
        db.execute("ALTER TABLE datasets ADD COLUMN IF NOT EXISTS lineage_id VARCHAR(100)");
        db.execute("CREATE TABLE IF NOT EXISTS dataset_lineages (id VARCHAR(100) PRIMARY KEY)");
        db.execute("CREATE TABLE IF NOT EXISTS dataset_forwards (source_dataset_id VARCHAR(100) NOT NULL, "
                + "recipient_issuer VARCHAR(600) NOT NULL, recipient_subject VARCHAR(200) NOT NULL, "
                + "recipient_username VARCHAR(200) NOT NULL, recipient_dataset_id VARCHAR(100) NOT NULL, "
                + "forwarded_at VARCHAR(40) NOT NULL, PRIMARY KEY(source_dataset_id,recipient_issuer,recipient_subject))");
        db.execute("CREATE INDEX IF NOT EXISTS dataset_lineage_owner ON datasets(lineage_id,owner_issuer,owner_subject,deleted_at)");
        db.execute("CREATE TABLE IF NOT EXISTS storage_reclamation (instance_id VARCHAR(100) PRIMARY KEY, "
                + "state VARCHAR(20) NOT NULL, requested_at VARCHAR(40) NOT NULL, attempts INTEGER NOT NULL DEFAULT 0)");
        db.execute("CREATE TABLE IF NOT EXISTS dataset_deletion_objects (dataset_id VARCHAR(100) NOT NULL, "
                + "instance_id VARCHAR(100) NOT NULL, PRIMARY KEY(dataset_id,instance_id))");
        db.execute("CREATE TABLE IF NOT EXISTS dataset_teams (dataset_id VARCHAR(100) PRIMARY KEY REFERENCES datasets(id), "
                + "team_id VARCHAR(100) NOT NULL REFERENCES teams(id))");
        db.execute("CREATE INDEX IF NOT EXISTS dataset_team_lookup ON dataset_teams(team_id)");
        if (seedEnabled) seedPublicDatasets();
    }

    void seedPublicDatasets() {
        transaction.executeWithoutResult(ignored -> {
            if (db.queryForObject("SELECT COUNT(*) FROM dataset_migrations WHERE id = 'public-ct-v1'", Integer.class) != 0) return;
            // The immutable manifest is an exact snapshot of the two pre-existing datasets.
            // Never enumerate Orthanc here: future direct imports must not become public.
            try (InputStream stream = new ClassPathResource("public-datasets.json").getInputStream()) {
                JsonNode seeds = JsonMapper.builder().build().readTree(stream);
                if (!seeds.isArray() || seeds.size() != 2) throw new IllegalStateException("Expected exactly two public CT seeds");
                for (JsonNode seed : seeds) {
                    String id = seed.path("id").asText();
                    db.update("INSERT INTO datasets (id,name,is_public,owner_username,created_at) VALUES (?,?,TRUE,?,?)",
                            id, seed.path("name").asText(), "公共影像", Instant.now().toString());
                    for (JsonNode instance : seed.path("instances")) {
                        db.update("INSERT INTO dataset_instances VALUES (?,?,?)", id, instance.path("id").asText(),
                                instance.path("instanceNumber").asText(""));
                    }
                }
                db.update("INSERT INTO dataset_migrations VALUES ('public-ct-v1',?)", Instant.now().toString());
            } catch (Exception exception) {
                throw new IllegalStateException("Unable to initialize the two public CT datasets", exception);
            }
        });
    }

    public OrthancService.Items<DatasetItem> list(DemoSession.Identity user) {
        validateIdentity(user);
        List<DatasetItem> items = db.query("SELECT d.*, (SELECT COUNT(*) FROM dataset_instances i WHERE i.dataset_id=d.id) AS instance_count "
                        + "FROM datasets d WHERE " + PERSONAL + " AND " + VISIBLE + " ORDER BY d.is_public DESC, d.created_at DESC, d.id",
                (r, n) -> item(DATASET.mapRow(r, n), r.getLong("instance_count"), user), identityArgs(user));
        return new OrthancService.Items<>(items, items.size());
    }

    public long visibleInstanceCount(DemoSession.Identity user) {
        validateIdentity(user);
        return db.queryForObject("SELECT COUNT(DISTINCT i.instance_id) FROM dataset_instances i JOIN datasets d ON d.id=i.dataset_id WHERE "
                + VISIBLE, Long.class, identityArgs(user));
    }

    public DatasetItem create(String name, DemoSession.Identity user) {
        validateIdentity(user);
        String clean = checkedName(name);
        String id = UUID.randomUUID().toString();
        String created = Instant.now().toString();
        db.update("INSERT INTO datasets (id,name,is_public,owner_issuer,owner_subject,owner_username,created_at) VALUES (?,?,FALSE,?,?,?,?)", id, clean, user.issuer(), user.subject(), user.username(), created);
        return new DatasetItem(id, clean, "owner", user.username(), 0, created, true);
    }

    public DatasetItem rename(String id, String name, DemoSession.Identity user) {
        String clean = checkedName(name);
        return transaction.execute(ignored -> {
            StoredDataset dataset = requireAccess(id, user, true);
            db.update("UPDATE datasets SET name=? WHERE id=?", clean, id);
            return item(new StoredDataset(dataset.id(), clean, dataset.publicDataset(), dataset.ownerIssuer(),
                    dataset.ownerSubject(), dataset.ownerUsername(), dataset.createdAt()), count(id), user);
        });
    }

    public OrthancService.Items<OrthancService.InstanceItem> instances(String id, DemoSession.Identity user) {
        requireAccess(id, user, false);
        List<OrthancService.InstanceItem> items = db.query("SELECT instance_id,instance_number FROM dataset_instances WHERE dataset_id=?",
                (r, n) -> new OrthancService.InstanceItem(r.getString(1), r.getString(2)), id);
        items.sort(Comparator.comparingLong((OrthancService.InstanceItem i) -> numericOrder(i.instanceNumber())).thenComparing(OrthancService.InstanceItem::id));
        return new OrthancService.Items<>(List.copyOf(items), items.size());
    }

    public void requireInstance(String datasetId, String instanceId, DemoSession.Identity user) {
        requireAccess(datasetId, user, false);
        if (db.queryForObject("SELECT COUNT(*) FROM dataset_instances WHERE dataset_id=? AND instance_id=?", Integer.class, datasetId, instanceId) == 0)
            throw unavailable();
    }

    /** Shared authorization/row lock used by related business resources such as segmentations. */
    public void requireDatasetAccess(String datasetId, DemoSession.Identity user, boolean lock) {
        requireAccess(datasetId, user, lock);
    }

    public OrthancService.ImportResult importDicom(String datasetId, byte[] bytes, DemoSession.Identity user) {
        return storage.reference(() -> transaction.execute(ignored -> {
            // Lock the dataset for mutations so a concurrent share revocation completes before or after this import.
            requireAccess(datasetId, user, true);
            OrthancService.ImportResult result = orthanc.importDicom(bytes);
            // Orthanc deduplicates by UIDs. Possessing guessed UIDs must not grant another uploader's pixels.
            if ("AlreadyStored".equals(result.status()) && !MessageDigest.isEqual(bytes, orthanc.file(result.id())))
                throw new ApiException(HttpStatus.CONFLICT, "DICOM 标识已存在，但文件内容不同；未加入当前影像集");
            OrthancService.InstanceItem instance = orthanc.instance(result.id());
            // Deduplication is physical only: each uploader gets their own exact membership.
            db.update("MERGE INTO dataset_instances (dataset_id,instance_id,instance_number) KEY(dataset_id,instance_id) VALUES (?,?,?)",
                    datasetId, result.id(), instance.instanceNumber());
            return result;
        }));
    }

    /** The HTTP upload route never materializes the whole multipart file in heap. */
    public OrthancService.ImportResult importDicomFile(String datasetId, MultipartFile file, DemoSession.Identity user) {
        return storage.reference(() -> transaction.execute(ignored -> {
            // Keep the same team -> dataset lock order through forwarding and association.
            requireAccess(datasetId, user, true);
            try (StagedDicom staged = StagedDicom.copy(file, importLimits)) {
                OrthancService.ImportResult result = orthanc.importDicomFile(staged.path());
                if ("AlreadyStored".equals(result.status()) && !orthanc.matchesDicomFile(result.id(), staged.path()))
                    throw new ApiException(HttpStatus.CONFLICT, "DICOM 标识已存在，但文件内容不同；未加入当前影像集");
                OrthancService.InstanceItem instance = orthanc.instance(result.id());
                db.update("MERGE INTO dataset_instances (dataset_id,instance_id,instance_number) KEY(dataset_id,instance_id) VALUES (?,?,?)",
                        datasetId, result.id(), instance.instanceNumber());
                return result;
            } catch (IOException exception) {
                throw new ApiException(HttpStatus.INTERNAL_SERVER_ERROR,
                        "导入暂存文件处理失败，本次结果可能尚未确认，请先核对资料库");
            }
        }));
    }

    public OrthancService.Items<ShareItem> shares(String id, DemoSession.Identity user) {
        requirePrivateAccess(id, user, false);
        List<ShareItem> items = db.query("SELECT recipient_subject,recipient_username FROM dataset_forwards WHERE source_dataset_id=? ORDER BY recipient_username,recipient_subject",
                (r, n) -> new ShareItem(r.getString(1), r.getString(2)), id);
        return new OrthancService.Items<>(items, items.size());
    }

    public ForwardResult share(String id, String subject, DemoSession.Identity user) {
        // Check permission before looking up another user's account.
        requirePrivateAccess(id, user, false);
        KeycloakDirectoryService.DirectoryUser recipient = directory.requireUser(subject);
        if (user.subject().equals(recipient.subject())) throw new ApiException(HttpStatus.BAD_REQUEST,"不能向自己转发");
        return storage.reference(() -> transaction.execute(ignored -> {
            lockLineage(id);
            requirePrivateAccess(id, user, true);
            return forwardLocked(id, issuer, recipient.subject(), recipient.username());
        }));
    }

    public void revoke(String id, String subject, DemoSession.Identity user) {
        requirePrivateAccess(id, user, false);
        throw new ApiException(HttpStatus.CONFLICT, "共享已转为对方独立拥有的副本，不能撤回或删除对方的副本");
    }

    /** Share a snapshot, never a grant. Caller holds storage -> lineage -> source dataset. */
    private ForwardResult forwardLocked(String id, String recipientIssuer, String recipientSubject, String recipientUsername) {
        String lineage=lineage(id);
        var existing=db.query("SELECT d.id FROM datasets d WHERE d.lineage_id=? AND d.owner_issuer=? AND d.owner_subject=? "
                + "AND d.deleted_at IS NULL AND NOT EXISTS (SELECT 1 FROM dataset_teams t WHERE t.dataset_id=d.id) ORDER BY d.created_at,d.id",
                (r,n)->r.getString(1),lineage,recipientIssuer,recipientSubject);
        String copy=existing.isEmpty()?UUID.randomUUID().toString():existing.getFirst();
        if(existing.isEmpty()) {
            db.update("INSERT INTO datasets (id,name,is_public,owner_issuer,owner_subject,owner_username,created_at,lineage_id) "
                    + "SELECT ?,name,FALSE,?,?,?,?,? FROM datasets WHERE id=?",copy,recipientIssuer,recipientSubject,recipientUsername,Instant.now().toString(),lineage,id);
            db.update("INSERT INTO dataset_instances SELECT ?,instance_id,instance_number FROM dataset_instances WHERE dataset_id=?",copy,id);
            // Reuse the actual current SEG, not superseded history or another user's request IDs.
            db.update("INSERT INTO segmentation_publications (dataset_id,series_id,version,author_issuer,author_subject,author_username,created_at,label,orthanc_id,annotated_slice_count) "
                    + "SELECT ?,p.series_id,p.version,p.author_issuer,p.author_subject,p.author_username,p.created_at,p.label,p.orthanc_id,p.annotated_slice_count "
                    + "FROM segmentation_publications p WHERE p.dataset_id=? AND p.storage_deleted_at IS NULL AND NOT EXISTS "
                    + "(SELECT 1 FROM segmentation_publications n WHERE n.dataset_id=p.dataset_id AND n.series_id=p.series_id AND n.version>p.version)",copy,id);
            // Also snapshot accepted, not-yet-archived edits. Do not copy leases, operation
            // IDs or activity totals. A dirty baseline is independently archived for its owner.
            db.update("INSERT INTO mask_rooms (dataset_id,series_id,seq,through_seq,published_version,data_json,sources_json,expires_at,archived_at,archive_error,baseline_issuer,baseline_subject,baseline_username) "
                    + "SELECT ?,series_id,CASE WHEN seq>through_seq THEN 1 ELSE 0 END,0,published_version,data_json,sources_json,0,0,'',?,?,? FROM mask_rooms WHERE dataset_id=?",
                    copy,recipientIssuer,recipientSubject,recipientUsername,id);
        }
        db.update("MERGE INTO dataset_forwards (source_dataset_id,recipient_issuer,recipient_subject,recipient_username,recipient_dataset_id,forwarded_at) "
                + "KEY(source_dataset_id,recipient_issuer,recipient_subject) VALUES (?,?,?,?,?,?)",id,recipientIssuer,recipientSubject,recipientUsername,copy,Instant.now().toString());
        return new ForwardResult(true,copy,!existing.isEmpty());
    }

    private String lineage(String id) {
        var values=db.query("SELECT COALESCE(lineage_id,id) FROM datasets WHERE id=?",(r,n)->r.getString(1),id);
        if(values.isEmpty()) throw unavailable();
        return values.getFirst();
    }

    private void lockLineage(String id) {
        String root=lineage(id);
        db.update("MERGE INTO dataset_lineages (id) KEY(id) VALUES (?)",root);
        db.queryForObject("SELECT id FROM dataset_lineages WHERE id=? FOR UPDATE",String.class,root);
        db.update("UPDATE datasets SET lineage_id=? WHERE id=? AND lineage_id IS NULL",root,id);
    }

    /** Runs once before readiness, after annotation/activity schemas exist. No Orthanc writes. */
    void migrateForwardingShares() {
        storage.reference(() -> transaction.execute(ignored -> {
            if(db.queryForObject("SELECT COUNT(*) FROM dataset_migrations WHERE id='personal-forward-copy-v1'",Integer.class)>0) return null;
            var grants=db.query("SELECT g.*,d.owner_issuer,d.owner_subject FROM dataset_grants g JOIN datasets d ON d.id=g.dataset_id "
                    + "WHERE d.deleted_at IS NULL AND d.is_public=FALSE AND NOT EXISTS (SELECT 1 FROM dataset_teams t WHERE t.dataset_id=d.id) ORDER BY g.dataset_id,g.user_subject",
                    (r,n)->List.of(r.getString("dataset_id"),r.getString("user_issuer"),r.getString("user_subject"),r.getString("username")));
            for(var grant:grants) {
                String id=grant.get(0); lockLineage(id);
                db.queryForObject("SELECT id FROM datasets WHERE id=? FOR UPDATE",String.class,id);
                String copy=forwardLocked(id,grant.get(1),grant.get(2),grant.get(3)).recipientDatasetId();
                db.update("INSERT INTO segmentation_drafts (dataset_id,series_id,user_issuer,user_subject,revision,base_version,label,masks_json,updated_at) "
                        + "SELECT ?,s.series_id,s.user_issuer,s.user_subject,s.revision,s.base_version,s.label,s.masks_json,s.updated_at FROM segmentation_drafts s "
                        + "WHERE s.dataset_id=? AND s.user_issuer=? AND s.user_subject=? AND NOT EXISTS (SELECT 1 FROM segmentation_drafts target "
                        + "WHERE target.dataset_id=? AND target.series_id=s.series_id AND target.user_issuer=s.user_issuer AND target.user_subject=s.user_subject)",
                        copy,id,grant.get(1),grant.get(2),copy);
                for(String table:List.of("dataset_favorites","dataset_recent_opens")) {
                    db.update("DELETE FROM "+table+" WHERE dataset_id=? AND user_issuer=? AND user_subject=? AND EXISTS "
                            + "(SELECT 1 FROM "+table+" other WHERE other.dataset_id=? AND other.user_issuer=? AND other.user_subject=?)",
                            id,grant.get(1),grant.get(2),copy,grant.get(1),grant.get(2));
                    db.update("UPDATE "+table+" SET dataset_id=? WHERE dataset_id=? AND user_issuer=? AND user_subject=?",copy,id,grant.get(1),grant.get(2));
                }
            }
            db.update("DELETE FROM dataset_grants");
            db.update("INSERT INTO dataset_migrations VALUES ('personal-forward-copy-v1',?)",Instant.now().toString());
            return null;
        }));
    }

    public void deletePersonal(String id, DemoSession.Identity user) {
        validateIdentity(user);
        storage.reference(() -> transaction.execute(ignored -> {
            // Include tombstones to acknowledge an owner's repeat DELETE without resurrecting it.
            var before=db.query("SELECT * FROM datasets WHERE id=?",DATASET,id);
            if(before.isEmpty()) throw unavailable();
            if(teamId(id)!=null) throw new ApiException(HttpStatus.BAD_REQUEST,"团队数据集请使用团队删除入口");
            if(before.getFirst().publicDataset()) throw new ApiException(HttpStatus.FORBIDDEN,"不能删除公共示例");
            if(!isOwner(before.getFirst(),user)) throw unavailable();
            lockLineage(id);
            db.queryForObject("SELECT id FROM datasets WHERE id=? FOR UPDATE",String.class,id);
            if(db.queryForObject("SELECT COUNT(*) FROM datasets WHERE id=? AND deleted_at IS NULL",Integer.class,id)==0) return null;
            long now=System.currentTimeMillis();
            if(db.queryForObject("SELECT COUNT(*) FROM mask_rooms WHERE dataset_id=? AND (expires_at>? OR seq>through_seq)",Integer.class,id,now)>0
                    || db.queryForObject("SELECT COUNT(*) FROM mask_slice_leases WHERE dataset_id=? AND expires_at>?",Integer.class,id,now)>0
                    || db.queryForObject("SELECT COUNT(*) FROM mask_snapshot_jobs WHERE dataset_id=? AND completed=FALSE",Integer.class,id)>0)
                throw new ApiException(HttpStatus.CONFLICT,"此数据集仍在编辑或等待标注归档，请关闭工作台并等候保存完成后再删除");
            var objects=db.query("SELECT instance_id FROM dataset_instances WHERE dataset_id=? UNION SELECT orthanc_id FROM segmentation_publications WHERE dataset_id=? "
                    + "UNION SELECT orthanc_id FROM mask_snapshot_jobs WHERE dataset_id=? AND orthanc_id IS NOT NULL",(r,n)->r.getString(1),id,id,id);
            db.update("UPDATE datasets SET deleted_at=? WHERE id=?",Instant.now().toString(),id);
            for(String object:objects) {
                db.update("MERGE INTO dataset_deletion_objects KEY(dataset_id,instance_id) VALUES (?,?)",id,object);
                db.update("MERGE INTO storage_reclamation (instance_id,state,requested_at,attempts) KEY(instance_id) VALUES (?,'pending',?,0)",object,Instant.now().toString());
            }
            // Keep small identity/version receipts and lifetime aggregate statistics;
            // remove obsolete server-side pixel payloads and account activity references.
            for(String table:List.of("mask_slice_leases","mask_ops","mask_rooms","mask_snapshot_jobs","segmentation_drafts","dataset_favorites","dataset_recent_opens"))
                db.update("DELETE FROM "+table+" WHERE dataset_id=?",id);
            return null;
        }));
    }

    void requireDeletionOwner(String id,DemoSession.Identity user) {
        validateIdentity(user);
        var rows=db.query("SELECT * FROM datasets WHERE id=? AND deleted_at IS NOT NULL",DATASET,id);
        if(rows.isEmpty() || rows.getFirst().publicDataset() || teamId(id)!=null || !isOwner(rows.getFirst(),user)) throw unavailable();
    }

    public OrthancService.Items<TeamDatasetItem> teamDatasets(String teamId, DemoSession.Identity user) {
        teams.requireMembership(teamId,user,false);
        var items=db.query("SELECT d.*, (SELECT COUNT(*) FROM dataset_instances i WHERE i.dataset_id=d.id) AS instance_count "
                + "FROM datasets d JOIN dataset_teams dt ON dt.dataset_id=d.id WHERE dt.team_id=? AND d.deleted_at IS NULL ORDER BY d.created_at DESC,d.id",
                (r,n)->teamItem(DATASET.mapRow(r,n),r.getLong("instance_count"),teamId,user),teamId);
        return new OrthancService.Items<>(items,items.size());
    }

    public TeamDatasetItem createTeamDataset(String teamId, String name, DemoSession.Identity user) {
        return transaction.execute(ignored->{
            teams.requireMembership(teamId,user,true);
            DatasetItem created=create(name,user);
            db.update("INSERT INTO dataset_teams VALUES (?,?)",created.id(),teamId);
            return teamItem(requireAccess(created.id(),user,false),0,teamId,user);
        });
    }

    /** Logical deletion protects Orthanc instances referenced by other business datasets. */
    public void deleteTeamDataset(String teamId,String id,DemoSession.Identity user) {
        transaction.executeWithoutResult(ignored->{
            teams.requireMembership(teamId,user,true);
            if(!teamId.equals(teamId(id))) throw unavailable();
            var rows=db.query("SELECT * FROM datasets WHERE id=? FOR UPDATE",DATASET,id);
            if(rows.isEmpty()) throw unavailable();
            if(!isOwner(rows.getFirst(),user)) throw new ApiException(HttpStatus.FORBIDDEN,"只能删除自己上传的团队数据集");
            db.update("UPDATE datasets SET deleted_at=COALESCE(deleted_at,?) WHERE id=?",Instant.now().toString(),id);
        });
    }

    private StoredDataset requirePrivateAccess(String id, DemoSession.Identity user, boolean lock) {
        StoredDataset dataset = requireAccess(id, user, lock);
        if(teamId(id)!=null) throw new ApiException(HttpStatus.BAD_REQUEST, "团队影像仅向当前团队成员开放，不提供个人或队外共享");
        if (dataset.publicDataset()) throw new ApiException(HttpStatus.BAD_REQUEST, "公共影像已向所有登录用户开放，无需设置共享");
        return dataset;
    }

    private StoredDataset requireAccess(String id, DemoSession.Identity user, boolean lock) {
        validateIdentity(user);
        String teamId=teamId(id);
        if(teamId!=null) teams.requireMembership(teamId,user,lock);
        List<StoredDataset> rows = db.query("SELECT * FROM datasets WHERE id=? AND deleted_at IS NULL" + (lock ? " FOR UPDATE" : ""), DATASET, id);
        if (rows.isEmpty()) throw unavailable();
        StoredDataset dataset = rows.getFirst();
        if (teamId==null && !dataset.publicDataset() && !isOwner(dataset, user)) throw unavailable();
        return dataset;
    }

    private long count(String id) { return db.queryForObject("SELECT COUNT(*) FROM dataset_instances WHERE dataset_id=?", Long.class, id); }
    void validateIdentity(DemoSession.Identity user) {
        if (user == null || !issuer.equals(user.issuer()) || user.subject() == null || user.subject().isBlank())
            throw new ApiException(HttpStatus.UNAUTHORIZED, "登录账户不属于当前服务器，请重新登录");
    }
    static Object[] identityArgs(DemoSession.Identity user) { return new Object[]{user.issuer(),user.subject(),user.issuer(),user.subject()}; }
    private String teamId(String id) {
        var rows=db.query("SELECT team_id FROM dataset_teams WHERE dataset_id=?",(r,n)->r.getString(1),id);
        return rows.isEmpty()?null:rows.getFirst();
    }
    private static TeamDatasetItem teamItem(StoredDataset d,long count,String teamId,DemoSession.Identity user) {
        return new TeamDatasetItem(d.id(),d.name(),isOwner(d,user)?"owner":"shared",d.ownerUsername(),count,d.createdAt(),"team",teamId,d.ownerSubject(),isOwner(d,user));
    }
    private static boolean isOwner(StoredDataset d, DemoSession.Identity user) { return user.issuer().equals(d.ownerIssuer()) && user.subject().equals(d.ownerSubject()); }
    private static DatasetItem item(StoredDataset d, long count, DemoSession.Identity user) {
        return new DatasetItem(d.id(),d.name(),d.publicDataset() ? "public" : isOwner(d,user) ? "owner" : "shared",d.ownerUsername(),count,d.createdAt(),!d.publicDataset()&&isOwner(d,user));
    }
    private static long numericOrder(String text) { try { return Long.parseLong(text.strip()); } catch (NumberFormatException e) { return Long.MAX_VALUE; } }
    private static String checkedName(String name) {
        if (name == null || name.isBlank() || name.strip().length() > 200)
            throw new ApiException(HttpStatus.BAD_REQUEST, "影像集名称不能为空，且不能超过 200 个字符");
        return name.strip();
    }
    private static ApiException unavailable() { return new ApiException(HttpStatus.NOT_FOUND, "未找到影像集或没有访问权限"); }
}
