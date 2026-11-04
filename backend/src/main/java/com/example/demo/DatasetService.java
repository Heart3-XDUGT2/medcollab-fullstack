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
                              long instanceCount, String createdAt) { }
    public record ShareItem(String subject, String username) { }
    public record TeamDatasetItem(String id, String name, String access, String ownerUsername,
                                  long instanceCount, String createdAt, String scope, String teamId,
                                  String uploaderSubject, boolean canDelete) { }
    private record StoredDataset(String id, String name, boolean publicDataset,
                                 String ownerIssuer, String ownerSubject, String ownerUsername, String createdAt) { }
    private static final String PERSONAL = "NOT EXISTS (SELECT 1 FROM dataset_teams dt WHERE dt.dataset_id=d.id)";
    static final String VISIBLE = "(d.deleted_at IS NULL AND ((" + PERSONAL + " AND (d.is_public = TRUE OR (d.owner_issuer = ? AND d.owner_subject = ?) "
            + "OR EXISTS (SELECT 1 FROM dataset_grants g WHERE g.dataset_id = d.id AND g.user_issuer = ? AND g.user_subject = ?))) "
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

    public DatasetService(JdbcTemplate db, PlatformTransactionManager manager, OrthancService orthanc,
            KeycloakDirectoryService directory, TeamService teams, @Value("${keycloak.issuer-uri}") String issuer,
            @Value("${app.datasets.seed-enabled:true}") boolean seedEnabled, ImportLimits importLimits) {
        this.db = db;
        this.transaction = new TransactionTemplate(manager);
        this.orthanc = orthanc;
        this.directory = directory;
        this.teams = teams;
        this.issuer = issuer;
        this.seedEnabled = seedEnabled;
        this.importLimits = importLimits;
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
        return new DatasetItem(id, clean, "owner", user.username(), 0, created);
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
        return transaction.execute(ignored -> {
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
        });
    }

    /** The HTTP upload route never materializes the whole multipart file in heap. */
    public OrthancService.ImportResult importDicomFile(String datasetId, MultipartFile file, DemoSession.Identity user) {
        return transaction.execute(ignored -> {
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
        });
    }

    public OrthancService.Items<ShareItem> shares(String id, DemoSession.Identity user) {
        requirePrivateAccess(id, user, false);
        List<ShareItem> items = db.query("SELECT user_subject,username FROM dataset_grants WHERE dataset_id=? ORDER BY username,user_subject",
                (r, n) -> new ShareItem(r.getString(1), r.getString(2)), id);
        return new OrthancService.Items<>(items, items.size());
    }

    public void share(String id, String subject, DemoSession.Identity user) {
        // Check permission before looking up another user's account.
        requirePrivateAccess(id, user, false);
        KeycloakDirectoryService.DirectoryUser recipient = directory.requireUser(subject);
        transaction.executeWithoutResult(ignored -> {
            StoredDataset dataset = requirePrivateAccess(id, user, true);
            if (issuer.equals(dataset.ownerIssuer()) && recipient.subject().equals(dataset.ownerSubject()))
                throw new ApiException(HttpStatus.BAD_REQUEST, "上传者已拥有全部权限，无需共享");
            db.update("MERGE INTO dataset_grants (dataset_id,user_issuer,user_subject,username) KEY(dataset_id,user_issuer,user_subject) VALUES (?,?,?,?)",
                    id, issuer, recipient.subject(), recipient.username());
        });
    }

    public void revoke(String id, String subject, DemoSession.Identity user) {
        requirePrivateAccess(id, user, false);
        throw new ApiException(HttpStatus.CONFLICT, "个人共享一经确认不可撤销，不能移除共享成员");
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
        if (teamId==null && !dataset.publicDataset() && !isOwner(dataset, user)
                && db.queryForObject("SELECT COUNT(*) FROM dataset_grants WHERE dataset_id=? AND user_issuer=? AND user_subject=?",
                Integer.class, id, user.issuer(), user.subject()) == 0) throw unavailable();
        return dataset;
    }

    private long count(String id) { return db.queryForObject("SELECT COUNT(*) FROM dataset_instances WHERE dataset_id=?", Long.class, id); }
    void validateIdentity(DemoSession.Identity user) {
        if (user == null || !issuer.equals(user.issuer()) || user.subject() == null || user.subject().isBlank())
            throw new ApiException(HttpStatus.UNAUTHORIZED, "登录账户不属于当前服务器，请重新登录");
    }
    static Object[] identityArgs(DemoSession.Identity user) { return new Object[]{user.issuer(),user.subject(),user.issuer(),user.subject(),user.issuer(),user.subject()}; }
    private String teamId(String id) {
        var rows=db.query("SELECT team_id FROM dataset_teams WHERE dataset_id=?",(r,n)->r.getString(1),id);
        return rows.isEmpty()?null:rows.getFirst();
    }
    private static TeamDatasetItem teamItem(StoredDataset d,long count,String teamId,DemoSession.Identity user) {
        return new TeamDatasetItem(d.id(),d.name(),isOwner(d,user)?"owner":"shared",d.ownerUsername(),count,d.createdAt(),"team",teamId,d.ownerSubject(),isOwner(d,user));
    }
    private static boolean isOwner(StoredDataset d, DemoSession.Identity user) { return user.issuer().equals(d.ownerIssuer()) && user.subject().equals(d.ownerSubject()); }
    private static DatasetItem item(StoredDataset d, long count, DemoSession.Identity user) {
        return new DatasetItem(d.id(),d.name(),d.publicDataset() ? "public" : isOwner(d,user) ? "owner" : "shared",d.ownerUsername(),count,d.createdAt());
    }
    private static long numericOrder(String text) { try { return Long.parseLong(text.strip()); } catch (NumberFormatException e) { return Long.MAX_VALUE; } }
    private static String checkedName(String name) {
        if (name == null || name.isBlank() || name.strip().length() > 200)
            throw new ApiException(HttpStatus.BAD_REQUEST, "影像集名称不能为空，且不能超过 200 个字符");
        return name.strip();
    }
    private static ApiException unavailable() { return new ApiException(HttpStatus.NOT_FOUND, "未找到影像集或没有访问权限"); }
}
