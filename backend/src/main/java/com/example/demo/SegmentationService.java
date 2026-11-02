package com.example.demo;

import java.time.Instant;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.HexFormat;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.function.Supplier;

import jakarta.annotation.PostConstruct;
import org.springframework.dao.PessimisticLockingFailureException;
import org.springframework.dao.QueryTimeoutException;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.TransactionTimedOutException;
import org.springframework.transaction.support.TransactionTemplate;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

/** Only published SEG metadata is stored here. Browser drafts live in IndexedDB. */
@Service
public class SegmentationService {
    public record PublishRequest(long expectedPublishedVersion, String label, List<DicomSegCodec.Mask> masks,
                                 String publicationId) { }
    public record LegacyDraft(long revision, long baseVersion, String label, List<DicomSegCodec.Mask> masks) { }
    public record Workspace(String seriesId, int rows, int columns, long publishedVersion, String publishedBy,
                            String publishedAt, String label, List<DicomSegCodec.Mask> masks, String orthancId) { }
    public record Status(String seriesId, int rows, int columns, long publishedVersion, String publishedBy,
                         String publishedAt, String label, String orthancId) { }
    public record LabelmapRequest(long expectedPublishedVersion,String label,DicomSegCodec.Labelmap data,String publicationId) { }
    public record LabelmapWorkspace(Status status,DicomSegCodec.Labelmap data) { }
    private record Draft(long revision, long baseVersion, String label, String masksJson) { }
    private record Publication(long version, String author, String createdAt, String label, String orthancId) { }

    private static final String DEFAULT_LABEL = "手绘区域";
    private static final int MAX_SLICES = 2048;
    private static final long MAX_SOURCE_PIXELS = 256L * 1024 * 1024;
    private static final int MAX_RUN_VALUES = 1_000_000;
    private final JdbcTemplate db;
    private final TransactionTemplate transaction;
    private final DatasetService datasets;
    private final OrthancService orthanc;
    private final DicomSegCodec codec;
    private final JsonMapper json = JsonMapper.builder().build();

    public SegmentationService(JdbcTemplate db, PlatformTransactionManager manager, DatasetService datasets,
            OrthancService orthanc, DicomSegCodec codec) {
        this.db = db;
        this.transaction = new TransactionTemplate(manager);
        this.datasets = datasets;
        this.orthanc = orthanc;
        this.codec = codec;
    }

    @PostConstruct
    void initialize() {
        db.execute("CREATE TABLE IF NOT EXISTS segmentation_drafts (dataset_id VARCHAR(100) NOT NULL REFERENCES datasets(id), "
                + "series_id VARCHAR(100) NOT NULL, user_issuer VARCHAR(600) NOT NULL, user_subject VARCHAR(200) NOT NULL, "
                + "revision BIGINT NOT NULL, base_version BIGINT NOT NULL, label VARCHAR(64) NOT NULL, masks_json CLOB NOT NULL, "
                + "updated_at VARCHAR(40) NOT NULL, PRIMARY KEY(dataset_id,series_id,user_issuer,user_subject))");
        db.execute("CREATE TABLE IF NOT EXISTS segmentation_publications (dataset_id VARCHAR(100) NOT NULL REFERENCES datasets(id), "
                + "series_id VARCHAR(100) NOT NULL, version BIGINT NOT NULL, author_issuer VARCHAR(600) NOT NULL, "
                + "author_subject VARCHAR(200) NOT NULL, author_username VARCHAR(200) NOT NULL, created_at VARCHAR(40) NOT NULL, "
                + "label VARCHAR(64) NOT NULL, orthanc_id VARCHAR(100) NOT NULL, PRIMARY KEY(dataset_id,series_id,version))");
        // The old table is read/delete only, until existing users migrate their drafts to IndexedDB.
        db.execute("ALTER TABLE segmentation_publications ADD COLUMN IF NOT EXISTS request_id VARCHAR(80)");
        db.execute("ALTER TABLE segmentation_publications ADD COLUMN IF NOT EXISTS request_hash VARCHAR(64)");
        db.execute("ALTER TABLE segmentation_publications ADD COLUMN IF NOT EXISTS through_seq BIGINT");
        db.execute("CREATE UNIQUE INDEX IF NOT EXISTS segmentation_publication_requests "
                + "ON segmentation_publications(dataset_id,series_id,request_id)");
    }

    public OrthancService.Items<DicomSegCodec.SourceImage> sources(String datasetId, DemoSession.Identity user) {
        List<DicomSegCodec.SourceImage> images = codec.sources(datasets.instances(datasetId, user).items());
        return new OrthancService.Items<>(images, images.size());
    }

    public Workspace workspace(String datasetId, String seriesId, DemoSession.Identity user) {
        datasets.requireDatasetAccess(datasetId, user, false);
        List<DicomSegCodec.SourceImage> source = seriesSources(datasetId, seriesId, user);
        return loadWorkspace(datasetId, seriesId, user, source);
    }

    public Status status(String datasetId, String seriesId, DemoSession.Identity user) {
        datasets.requireDatasetAccess(datasetId, user, false);
        List<DicomSegCodec.SourceImage> source = seriesSources(datasetId, seriesId, user);
        Publication published = latest(datasetId, seriesId);
        return new Status(seriesId, source.getFirst().rows(), source.getFirst().columns(), version(published),
                published == null ? null : published.author(), published == null ? null : published.createdAt(),
                published == null ? DEFAULT_LABEL : published.label(), published == null ? null : published.orthancId());
    }

    public Workspace publish(String datasetId, String seriesId, PublishRequest request, DemoSession.Identity user) {
        return mutate(() -> {
            datasets.requireDatasetAccess(datasetId, user, true);
            requireLegacyPublication(datasetId, seriesId);
            List<DicomSegCodec.SourceImage> source = seriesSources(datasetId, seriesId, user);
            if (request == null || request.expectedPublishedVersion() < 0 || request.publicationId() == null
                    || !request.publicationId().matches("[a-zA-Z0-9-]{16,80}"))
                throw badRequest("上传请求格式不正确，请使用新版绘制器");
            String label = checkedLabel(request.label());
            List<DicomSegCodec.Mask> masks = checkedMasks(request.masks(), source);
            String hash = contentHash(request.expectedPublishedVersion(), label, masks);
            var retried = db.query("SELECT author_issuer,author_subject,request_hash FROM segmentation_publications "
                            + "WHERE dataset_id=? AND series_id=? AND request_id=?",
                    (r,n) -> List.of(r.getString(1),r.getString(2),r.getString(3)),datasetId,seriesId,request.publicationId());
            if (!retried.isEmpty()) {
                if (!retried.getFirst().equals(List.of(user.issuer(),user.subject(),hash)))
                    throw conflict("上传编号已用于不同内容，请重新保存本地草稿");
                return loadWorkspace(datasetId,seriesId,user,source);
            }
            Publication previous = latest(datasetId, seriesId);
            if (request.expectedPublishedVersion() != version(previous))
                throw conflict("其他用户已上传新版本，请保留浏览器草稿并加载最新版本后再操作");
            if (masks.isEmpty() && previous == null) throw badRequest("请至少绘制一个像素后再保存并上传");
            byte[] dicom = codec.encode(source, label, masks);
            OrthancService.ImportResult uploaded = orthanc.importDicom(dicom);
            // Verify the actual stored DICOM SEG before publishing its reference to other users.
            List<DicomSegCodec.Mask> stored = checkedMasks(codec.decode(orthanc.file(uploaded.id()), source), source);
            if (!masks.equals(stored))
                throw new ApiException(HttpStatus.BAD_GATEWAY, "Orthanc 中的掩码与上传内容不一致，请保留浏览器草稿后重试");
            long nextVersion = version(previous) + 1;
            db.update("INSERT INTO segmentation_publications "
                            + "(dataset_id,series_id,version,author_issuer,author_subject,author_username,created_at,label,orthanc_id,request_id,request_hash) "
                            + "VALUES (?,?,?,?,?,?,?,?,?,?,?)",
                    datasetId, seriesId, nextVersion, user.issuer(), user.subject(), user.username(),
                    Instant.now().toString(), label, uploaded.id(), request.publicationId(), hash);
            return loadWorkspace(datasetId, seriesId, user, source);
        });
    }

    public LabelmapWorkspace labelmap(String datasetId,String seriesId,DemoSession.Identity user) {
        var source=seriesSources(datasetId,seriesId,user);
        var publication=latest(datasetId,seriesId);
        var status=new Status(seriesId,source.getFirst().rows(),source.getFirst().columns(),version(publication),
                publication==null?null:publication.author(),publication==null?null:publication.createdAt(),
                publication==null?DEFAULT_LABEL:publication.label(),publication==null?null:publication.orthancId());
        return new LabelmapWorkspace(status,publication==null
                ? new DicomSegCodec.Labelmap(List.of(),List.of())
                : checkedLabelmap(codec.decodeLabelmap(orthanc.file(publication.orthancId()),source),source));
    }

    public Status publishLabelmap(String datasetId,String seriesId,LabelmapRequest request,DemoSession.Identity user) {
        return mutate(()->{
            datasets.requireDatasetAccess(datasetId,user,true);
            requireLegacyPublication(datasetId,seriesId);
            var source=seriesSources(datasetId,seriesId,user);
            if(request==null || request.expectedPublishedVersion()<0 || request.publicationId()==null
                    || !request.publicationId().matches("[a-zA-Z0-9-]{16,80}")) throw badRequest("发布请求编号或版本无效");
            String label=checkedLabel(request.label());
            var data=checkedLabelmap(request.data(),source);
            String hash;
            try {hash=HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(
                    json.writeValueAsBytes(List.of("LABELMAP",request.expectedPublishedVersion(),label,data))));}
            catch(java.security.NoSuchAlgorithmException e) {throw new IllegalStateException(e);}
            var retry=db.query("SELECT author_issuer,author_subject,request_hash FROM segmentation_publications WHERE dataset_id=? AND series_id=? AND request_id=?",
                    (r,n)->List.of(r.getString(1),r.getString(2),r.getString(3)),datasetId,seriesId,request.publicationId());
            if(!retry.isEmpty()) {
                if(!retry.getFirst().equals(List.of(user.issuer(),user.subject(),hash))) throw conflict("发布编号已用于不同内容或账户");
                var receipt=db.query("SELECT version,author_username,created_at,label,orthanc_id FROM segmentation_publications WHERE dataset_id=? AND series_id=? AND request_id=?",
                        (r,n)->new Publication(r.getLong(1),r.getString(2),r.getString(3),r.getString(4),r.getString(5)),datasetId,seriesId,request.publicationId()).getFirst();
                return new Status(seriesId,source.getFirst().rows(),source.getFirst().columns(),receipt.version(),receipt.author(),receipt.createdAt(),receipt.label(),receipt.orthancId());
            }
            var previous=latest(datasetId,seriesId);
            if(request.expectedPublishedVersion()!=version(previous)) throw conflict("其他用户已发布新版本。本地草稿已保留，请先导出或加载最新版本后重画");
            if(previous==null && data.masks().isEmpty()) throw badRequest("请至少绘制一个像素后再发布");
            byte[] dicom=codec.encodeLabelmap(source,label,data);
            var uploaded=orthanc.importDicom(dicom);
            var stored=checkedLabelmap(codec.decodeLabelmap(orthanc.file(uploaded.id()),source),source);
            // Colors may round by one during the standard RGB/CIELab conversion; pixels and labels must match exactly.
            if(!data.masks().equals(stored.masks()) || !data.segments().stream().map(s->List.of(s.number(),s.label())).toList()
                    .equals(stored.segments().stream().map(s->List.of(s.number(),s.label())).toList()))
                throw new ApiException(HttpStatus.BAD_GATEWAY,"Orthanc 中的 Labelmap 与发布内容不一致");
            db.update("INSERT INTO segmentation_publications (dataset_id,series_id,version,author_issuer,author_subject,author_username,created_at,label,orthanc_id,request_id,request_hash) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
                    datasetId,seriesId,version(previous)+1,user.issuer(),user.subject(),user.username(),Instant.now().toString(),label,uploaded.id(),request.publicationId(),hash);
            return status(datasetId,seriesId,user);
        });
    }

    public byte[] exportLabelmap(String datasetId,String seriesId,LabelmapRequest request,DemoSession.Identity user) {
        var source=seriesSources(datasetId,seriesId,user);
        return codec.encodeLabelmap(source,checkedLabel(request.label()),checkedLabelmap(request.data(),source));
    }

    DicomSegCodec.Labelmap checkedLabelmap(DicomSegCodec.Labelmap data,List<DicomSegCodec.SourceImage> source) {
        if(data==null||data.segments()==null||data.masks()==null||data.segments().isEmpty()||data.segments().size()>64||data.masks().size()>MAX_SLICES)
            throw badRequest("Labelmap 必须包含 1 至 64 个标签");
        Set<Integer> numbers=new HashSet<>();
        var segments=new ArrayList<DicomSegCodec.Segment>();
        for(var s:data.segments()) {
            if(s==null||s.number()<1||s.number()>255||!numbers.add(s.number())||s.color()==null||s.color().size()!=3
                    ||s.color().stream().anyMatch(c->c==null||c<0||c>255)) throw badRequest("标签编号或颜色无效");
            segments.add(new DicomSegCodec.Segment(s.number(),checkedLabel(s.label()),s.color()));
        }
        segments.sort(java.util.Comparator.comparingInt(DicomSegCodec.Segment::number));
        Map<String,DicomSegCodec.SourceImage> allowed=new HashMap<>(); source.forEach(s->allowed.put(s.id(),s));
        Map<String,DicomSegCodec.Mask> masks=new HashMap<>(); Set<String> seen=new HashSet<>(); long count=0;
        for(var mask:data.masks()) {
            if(mask==null||!allowed.containsKey(mask.instanceId())||!seen.add(mask.instanceId())||mask.runs()==null
                    ||mask.runs().size()%3!=0||(count+=mask.runs().size())>MAX_RUN_VALUES) throw badRequest("Labelmap 切片或游程格式无效");
            long end=-1,pixels=(long)allowed.get(mask.instanceId()).rows()*allowed.get(mask.instanceId()).columns();
            List<Integer> runs=new ArrayList<>();
            for(int i=0;i<mask.runs().size();i+=3) {
                Integer start=mask.runs().get(i),length=mask.runs().get(i+1),number=mask.runs().get(i+2);
                if(start==null||length==null||number==null||start<0||length<=0||start<end||(long)start+length>pixels||!numbers.contains(number))
                    throw badRequest("Labelmap 像素越界、重叠或标签不存在");
                if(start==end&&!runs.isEmpty()&&runs.getLast().equals(number)) runs.set(runs.size()-2,runs.get(runs.size()-2)+length);
                else {runs.add(start);runs.add(length);runs.add(number);}
                end=(long)start+length;
            }
            if(!runs.isEmpty()) masks.put(mask.instanceId(),new DicomSegCodec.Mask(mask.instanceId(),List.copyOf(runs)));
        }
        return new DicomSegCodec.Labelmap(List.copyOf(segments),source.stream().map(s->masks.get(s.id())).filter(Objects::nonNull).toList());
    }

    /** One-time upgrade bridge: never creates or updates a server draft. */
    public LegacyDraft legacyDraft(String datasetId, String seriesId, DemoSession.Identity user) {
        datasets.requireDatasetAccess(datasetId,user,false);
        List<DicomSegCodec.SourceImage> source = seriesSources(datasetId,seriesId,user);
        Draft draft = ownDraft(datasetId,seriesId,user);
        return draft == null ? null : new LegacyDraft(draft.revision(),draft.baseVersion(),draft.label(),
                checkedMasks(readMasks(draft.masksJson()),source));
    }

    public void acknowledgeLegacyDraft(String datasetId, String seriesId, long revision, DemoSession.Identity user) {
        mutate(() -> {
            datasets.requireDatasetAccess(datasetId,user,true);
            Draft draft = ownDraft(datasetId,seriesId,user);
            if (draft != null && draft.revision() != revision) throw conflict("旧版草稿版本已变化，尚未清除");
            deleteOwnDraft(datasetId,seriesId,user);
            return null;
        });
    }

    public void rejectServerDraft(String datasetId, DemoSession.Identity user) {
        datasets.requireDatasetAccess(datasetId,user,false);
        throw new ApiException(HttpStatus.GONE,"Java 草稿接口已停用；请刷新新版绘制器，草稿改存浏览器 IndexedDB");
    }

    public byte[] file(String datasetId, String seriesId, DemoSession.Identity user) {
        datasets.requireDatasetAccess(datasetId, user, false);
        seriesSources(datasetId, seriesId, user);
        Publication published = latest(datasetId, seriesId);
        if (published == null) throw new ApiException(HttpStatus.NOT_FOUND, "此序列尚未上传 DICOM SEG");
        return orthanc.file(published.orthancId());
    }

    private Workspace loadWorkspace(String datasetId, String seriesId, DemoSession.Identity user,
            List<DicomSegCodec.SourceImage> source) {
        Publication published = latest(datasetId, seriesId);
        return new Workspace(seriesId, source.getFirst().rows(), source.getFirst().columns(), version(published),
                published == null ? null : published.author(), published == null ? null : published.createdAt(),
                published == null ? DEFAULT_LABEL : published.label(), readPublishedMasks(published,source),
                published == null ? null : published.orthancId());
    }

    private String contentHash(long version, String label, List<DicomSegCodec.Mask> masks) {
        try {
            byte[] content = json.writeValueAsString(List.of(version,label,masks)).getBytes(StandardCharsets.UTF_8);
            return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(content));
        } catch (java.security.NoSuchAlgorithmException exception) { throw new IllegalStateException(exception); }
    }

    private List<DicomSegCodec.Mask> readPublishedMasks(Publication publication, List<DicomSegCodec.SourceImage> source) {
        return publication == null ? List.of() : checkedMasks(codec.decode(orthanc.file(publication.orthancId()), source), source);
    }

    List<DicomSegCodec.SourceImage> seriesSources(String datasetId, String seriesId, DemoSession.Identity user) {
        List<DicomSegCodec.SourceImage> result = sources(datasetId, user).items().stream()
                .filter(s -> Objects.equals(seriesId, s.seriesId())).toList();
        if (result.isEmpty()) throw new ApiException(HttpStatus.NOT_FOUND, "此影像集中没有对应的可标注 CT 序列");
        if (result.size() > MAX_SLICES) throw badRequest("此序列过大，当前演示最多支持 2048 张切片");
        DicomSegCodec.SourceImage first = result.getFirst();
        if (first.rows() <= 0 || first.columns() <= 0) throw badRequest("CT 图像尺寸不正确");
        long pixels = (long) first.rows() * first.columns();
        if (pixels > Integer.MAX_VALUE || pixels * result.size() > MAX_SOURCE_PIXELS)
            throw badRequest("此 CT 序列超出当前演示的掩码处理大小限制");
        if (result.stream().anyMatch(s -> s.rows() != first.rows() || s.columns() != first.columns()))
            throw badRequest("此序列包含不同尺寸的图像，当前演示暂不支持一起标注");
        return result;
    }

    private List<DicomSegCodec.Mask> checkedMasks(List<DicomSegCodec.Mask> requested,
            List<DicomSegCodec.SourceImage> source) {
        if (requested == null || requested.size() > MAX_SLICES) throw badRequest("掩码切片列表格式不正确或数量过多");
        Map<String,DicomSegCodec.SourceImage> allowed = new HashMap<>();
        source.forEach(s -> allowed.put(s.id(), s));
        Map<String,DicomSegCodec.Mask> normalized = new HashMap<>();
        Set<String> seen = new HashSet<>();
        long runValues = 0;
        for (DicomSegCodec.Mask mask : requested) {
            if (mask == null || !allowed.containsKey(mask.instanceId()) || !seen.add(mask.instanceId()))
                throw badRequest("掩码包含不属于当前 CT 序列的切片，或切片重复");
            List<Integer> runs = mask.runs();
            if (runs == null || runs.size() % 2 != 0 || (runValues += runs.size()) > MAX_RUN_VALUES)
                throw badRequest("掩码编码格式不正确或数据过大");
            long pixels = (long) allowed.get(mask.instanceId()).rows() * allowed.get(mask.instanceId()).columns();
            long previousEnd = -1;
            List<Integer> canonical = new ArrayList<>();
            for (int i = 0; i < runs.size(); i += 2) {
                Integer start = runs.get(i), length = runs.get(i + 1);
                if (start == null || length == null || start < 0 || length <= 0 || start < previousEnd
                        || (long) start + length > pixels) throw badRequest("掩码像素越界或编码重叠");
                if (start == previousEnd) {
                    canonical.set(canonical.size() - 1, canonical.getLast() + length);
                } else {
                    canonical.add(start);
                    canonical.add(length);
                }
                previousEnd = (long) start + length;
            }
            if (!canonical.isEmpty()) normalized.put(mask.instanceId(), new DicomSegCodec.Mask(mask.instanceId(), List.copyOf(canonical)));
        }
        // Stable source ordering also permits exact encode/storage/decode comparisons.
        return source.stream().map(s -> normalized.get(s.id())).filter(Objects::nonNull).toList();
    }

    private Draft ownDraft(String datasetId, String seriesId, DemoSession.Identity user) {
        var rows = db.query("SELECT revision,base_version,label,masks_json FROM segmentation_drafts "
                        + "WHERE dataset_id=? AND series_id=? AND user_issuer=? AND user_subject=?",
                (r,n) -> new Draft(r.getLong(1),r.getLong(2),r.getString(3),r.getString(4)),
                datasetId,seriesId,user.issuer(),user.subject());
        return rows.isEmpty() ? null : rows.getFirst();
    }

    private Publication latest(String datasetId, String seriesId) {
        var rows = db.query("SELECT version,author_username,created_at,label,orthanc_id FROM segmentation_publications "
                        + "WHERE dataset_id=? AND series_id=? ORDER BY version DESC LIMIT 1",
                (r,n) -> new Publication(r.getLong(1),r.getString(2),r.getString(3),r.getString(4),r.getString(5)), datasetId,seriesId);
        return rows.isEmpty() ? null : rows.getFirst();
    }

    private List<DicomSegCodec.Mask> readMasks(String storedJson) {
        try {
            JsonNode data = json.readTree(storedJson);
            if (!data.isArray()) throw new IllegalArgumentException();
            List<DicomSegCodec.Mask> masks = new ArrayList<>();
            for (JsonNode mask : data) {
                List<Integer> runs = new ArrayList<>();
                for (JsonNode value : mask.path("runs")) runs.add(value.asInt());
                masks.add(new DicomSegCodec.Mask(mask.path("instanceId").asText(),List.copyOf(runs)));
            }
            return List.copyOf(masks);
        } catch (Exception exception) {
            throw new ApiException(HttpStatus.INTERNAL_SERVER_ERROR, "无法读取 Java 中保存的掩码草稿，请查看服务器日志");
        }
    }

    private void deleteOwnDraft(String datasetId, String seriesId, DemoSession.Identity user) {
        db.update("DELETE FROM segmentation_drafts WHERE dataset_id=? AND series_id=? AND user_issuer=? AND user_subject=?",
                datasetId,seriesId,user.issuer(),user.subject());
    }

    private <T> T mutate(Supplier<T> action) {
        try { return transaction.execute(ignored -> action.get()); }
        catch (PessimisticLockingFailureException | QueryTimeoutException | TransactionTimedOutException exception) {
            throw new ApiException(HttpStatus.LOCKED, "其他用户正在保存此影像集，请稍后重试；当前绘制内容应保留后重试");
        }
    }

    private static long version(Publication publication) { return publication == null ? 0 : publication.version(); }

    private void requireLegacyPublication(String datasetId, String seriesId) {
        if (db.queryForObject("SELECT COUNT(*) FROM mask_rooms WHERE dataset_id=? AND series_id=?",
                Integer.class, datasetId, seriesId) > 0)
            throw conflict("此序列已启用可靠协作，请使用新版工作区同步并生成归档版本，不能整量覆盖");
    }

    /** Slow encoding/upload is deliberately outside the operation/lease database transaction. */
    String uploadCollaborativeSnapshot(List<DicomSegCodec.SourceImage> source, DicomSegCodec.Labelmap data) {
        data = checkedLabelmap(data, source);
        var uploaded = orthanc.importDicom(codec.encodeLabelmap(source, "医学标注", data));
        var stored = checkedLabelmap(codec.decodeLabelmap(orthanc.file(uploaded.id()), source), source);
        if (!data.masks().equals(stored.masks()) || !data.segments().stream().map(s -> List.of(s.number(),s.label())).toList()
                .equals(stored.segments().stream().map(s -> List.of(s.number(),s.label())).toList()))
            throw new ApiException(HttpStatus.BAD_GATEWAY, "归档 SEG 读回校验失败，操作流水仍安全保留");
        return uploaded.id();
    }

    /** Caller holds the dataset lock; only the verified snapshot's fixed watermark is registered. */
    long recordCollaborativeSnapshot(String datasetId, String seriesId, long expectedVersion, long throughSeq,
            String orthancId, DemoSession.Identity author) {
        var previous = latest(datasetId, seriesId);
        if (version(previous) != expectedVersion) throw conflict("归档基线已变化，请重试");
        long next = expectedVersion + 1;
        db.update("INSERT INTO segmentation_publications "
                + "(dataset_id,series_id,version,author_issuer,author_subject,author_username,created_at,label,orthanc_id,request_id,through_seq) "
                + "VALUES (?,?,?,?,?,?,?,?,?,?,?)", datasetId,seriesId,next,author.issuer(),author.subject(),author.username(),
                Instant.now().toString(),"医学标注",orthancId,"collab-snapshot-"+throughSeq,throughSeq);
        return next;
    }
    private static String checkedLabel(String label) {
        if (label == null || label.isBlank() || label.strip().length() > 64
                || label.chars().anyMatch(Character::isISOControl)) throw badRequest("掩码名称不能为空，且不能超过 64 个字符");
        return label.strip();
    }
    private static ApiException badRequest(String message) { return new ApiException(HttpStatus.BAD_REQUEST,message); }
    private static ApiException conflict(String message) { return new ApiException(HttpStatus.CONFLICT,message); }
}
