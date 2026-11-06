package com.example.demo;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.time.Instant;
import java.util.*;
import java.util.concurrent.ConcurrentHashMap;

import jakarta.annotation.PostConstruct;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;
import tools.jackson.databind.json.JsonMapper;

/** Durable per-series operation stream. Socket delivery is a notification, never the save receipt. */
@Service
public class CollaborationService {
    public record Operation(String clientOpId, long baseSeq, List<DicomSegCodec.Segment> segments,
                            List<DicomSegCodec.Mask> masks) { }
    public record Batch(String clientId, String leaseId, List<Operation> operations, Boolean sliced) {
        public Batch(String clientId,String leaseId,List<Operation> operations) { this(clientId,leaseId,operations,false); }
    }
    public record LeaseRequest(String clientId, String leaseId, String action) { }
    public record SliceRequest(String clientId,String leaseId,String action,List<String> instanceIds) { }
    public record SliceLease(String instanceId,boolean heldBySelf,String subject,String username,String leaseId,String expiresAt) { }
    public record Lease(boolean heldBySelf, String subject, String username, String leaseId, String expiresAt) { }
    public record Committed(long seq, String clientOpId, String subject, String username, Operation operation, String at) { }
    public record State(int protocolVersion, long seq, long throughSeq, long publishedVersion,
                        DicomSegCodec.Labelmap data, Lease lease, String archiveError,List<SliceLease> sliceLeases) { }
    public record Page(long highWatermark, List<Committed> operations, Lease lease, long throughSeq,
                       long publishedVersion, String archiveError,List<SliceLease> sliceLeases) { }
    private record Room(long seq, long throughSeq, long version, DicomSegCodec.Labelmap data,
                        String sourceJson, String holderIssuer, String holderSubject, String holderUsername,
                        String clientId, String leaseId, long expiresAt, long archivedAt, String archiveError) { }
    private record Archive(String datasetId, String seriesId, long seq, long version,
                           DicomSegCodec.Labelmap data, List<DicomSegCodec.SourceImage> sources,
                           DemoSession.Identity author, String orthancId) { }
    private static final Logger log = LoggerFactory.getLogger(CollaborationService.class);
    private static final long LEASE_MILLIS = 30_000;
    private final JdbcTemplate db;
    private final TransactionTemplate tx;
    private final DatasetService datasets;
    private final SegmentationService segmentations;
    private final AnnotationActivityRecorder activity;
    private final SegmentationStorageGuard storage;
    private final JsonMapper json = JsonMapper.builder().build();
    private final Set<String> archiving = ConcurrentHashMap.newKeySet();
    private final long archiveMillis;
    private final int archiveOperations;

    public CollaborationService(JdbcTemplate db, PlatformTransactionManager manager, DatasetService datasets,
            SegmentationService segmentations, AnnotationActivityRecorder activity, @Value("${app.collaboration.archive-ms:20000}") long archiveMillis,
            @Value("${app.collaboration.archive-operations:100}") int archiveOperations, SegmentationStorageGuard storage) {
        this.db=db; this.tx=new TransactionTemplate(manager); this.datasets=datasets; this.segmentations=segmentations;
        this.activity=activity;
        this.storage=storage;
        this.archiveMillis=Math.max(1000,archiveMillis); this.archiveOperations=Math.max(1,archiveOperations);
    }

    @PostConstruct
    void initialize() {
        // No cascading deletion: accepted operations and archive jobs remain audit records after logical deletion.
        db.execute("CREATE TABLE IF NOT EXISTS mask_rooms (dataset_id VARCHAR(100) NOT NULL, series_id VARCHAR(100) NOT NULL, "
                + "seq BIGINT NOT NULL, through_seq BIGINT NOT NULL, published_version BIGINT NOT NULL, data_json CLOB NOT NULL, "
                + "sources_json CLOB NOT NULL, holder_issuer VARCHAR(600), holder_subject VARCHAR(200), holder_username VARCHAR(200), "
                + "client_id VARCHAR(80), lease_id VARCHAR(80), expires_at BIGINT NOT NULL, archived_at BIGINT NOT NULL, "
                + "archive_error VARCHAR(200) NOT NULL, PRIMARY KEY(dataset_id,series_id))");
        db.execute("CREATE TABLE IF NOT EXISTS mask_ops (dataset_id VARCHAR(100) NOT NULL, series_id VARCHAR(100) NOT NULL, "
                + "seq BIGINT NOT NULL, client_op_id VARCHAR(80) NOT NULL, author_issuer VARCHAR(600) NOT NULL, "
                + "author_subject VARCHAR(200) NOT NULL, author_username VARCHAR(200) NOT NULL, request_hash VARCHAR(64) NOT NULL, "
                + "operation_json CLOB NOT NULL, created_at VARCHAR(40) NOT NULL, PRIMARY KEY(dataset_id,series_id,seq), "
                + "UNIQUE(dataset_id,series_id,client_op_id))");
        db.execute("CREATE TABLE IF NOT EXISTS mask_snapshot_jobs (dataset_id VARCHAR(100) NOT NULL, series_id VARCHAR(100) NOT NULL, "
                + "through_seq BIGINT NOT NULL, plan_json CLOB NOT NULL, orthanc_id VARCHAR(100), completed BOOLEAN NOT NULL, "
                + "PRIMARY KEY(dataset_id,series_id,through_seq))");
        db.execute("CREATE TABLE IF NOT EXISTS mask_slice_leases (dataset_id VARCHAR(100) NOT NULL, series_id VARCHAR(100) NOT NULL, "
                + "instance_id VARCHAR(100) NOT NULL, holder_issuer VARCHAR(600), holder_subject VARCHAR(200), holder_username VARCHAR(200), "
                + "client_id VARCHAR(80), lease_id VARCHAR(80), expires_at BIGINT NOT NULL, modified_seq BIGINT NOT NULL, "
                + "writer_lease VARCHAR(80), PRIMARY KEY(dataset_id,series_id,instance_id))");
        db.execute("ALTER TABLE mask_rooms ADD COLUMN IF NOT EXISTS baseline_issuer VARCHAR(600)");
        db.execute("ALTER TABLE mask_rooms ADD COLUMN IF NOT EXISTS baseline_subject VARCHAR(200)");
        db.execute("ALTER TABLE mask_rooms ADD COLUMN IF NOT EXISTS baseline_username VARCHAR(200)");
    }

    void authorize(String datasetId, String seriesId, DemoSession.Identity user) {
        segmentations.seriesSources(datasetId,seriesId,user);
    }

    boolean previewAllowed(String datasetId,String seriesId,String clientId,DemoSession.Identity user) {
        return db.queryForObject("SELECT COUNT(*) FROM mask_rooms WHERE dataset_id=? AND series_id=? AND holder_issuer=? "
                + "AND holder_subject=? AND client_id=? AND expires_at>?",Integer.class,
                datasetId,seriesId,user.issuer(),user.subject(),clientId,System.currentTimeMillis())==1
                || db.queryForObject("SELECT COUNT(*) FROM mask_slice_leases WHERE dataset_id=? AND series_id=? AND holder_issuer=? "
                + "AND holder_subject=? AND client_id=? AND expires_at>?",Integer.class,
                datasetId,seriesId,user.issuer(),user.subject(),clientId,System.currentTimeMillis())>0;
    }

    public State state(String datasetId,String seriesId,String clientId,DemoSession.Identity user) {
        checkedId(clientId);
        return tx.execute(ignored -> {
            datasets.requireDatasetAccess(datasetId,user,true);
            Room room=ensureRoom(datasetId,seriesId,user);
            return new State(2,room.seq,room.throughSeq,room.version,room.data,view(room,clientId,user),room.archiveError,slices(datasetId,seriesId,clientId,user));
        });
    }

    public Page operations(String datasetId,String seriesId,String clientId,long after,DemoSession.Identity user) {
        checkedId(clientId);
        if(after<0) throw bad("操作游标无效");
        return tx.execute(ignored -> {
            datasets.requireDatasetAccess(datasetId,user,true);
            Room room=ensureRoom(datasetId,seriesId,user);
            if(after>room.seq) throw conflict("操作游标超出当前序列，请重新同步共同画布");
            var ops=db.query("SELECT * FROM mask_ops WHERE dataset_id=? AND series_id=? AND seq>? AND seq<=? ORDER BY seq LIMIT 100",
                    (r,n)->new Committed(r.getLong("seq"),r.getString("client_op_id"),r.getString("author_subject"),
                            r.getString("author_username"),json.readValue(r.getString("operation_json"),Operation.class),r.getString("created_at")),
                    datasetId,seriesId,after,room.seq);
            return new Page(room.seq,ops,view(room,clientId,user),room.throughSeq,room.version,room.archiveError,slices(datasetId,seriesId,clientId,user));
        });
    }

    public Lease lease(String datasetId,String seriesId,LeaseRequest request,DemoSession.Identity user) {
        if(request==null) throw bad("编辑权请求为空");
        checkedId(request.clientId);
        return tx.execute(ignored -> {
            datasets.requireDatasetAccess(datasetId,user,true);
            Room room=ensureRoom(datasetId,seriesId,user);
            long now=System.currentTimeMillis();
            boolean ours=owns(room,request.clientId,user);
            if("acquire".equals(request.action)) {
                if(!slices(datasetId,seriesId,request.clientId,user).isEmpty()) throw locked("切片正在协作编辑，请刷新页面使用切片编辑模式");
                if(room.expiresAt>now&&!ours) throw locked("其他页面正在编辑此序列，请等待释放");
                String token=ours&&room.expiresAt>now?room.leaseId:UUID.randomUUID().toString();
                db.update("UPDATE mask_rooms SET holder_issuer=?,holder_subject=?,holder_username=?,client_id=?,lease_id=?,expires_at=? "
                        + "WHERE dataset_id=? AND series_id=?",user.issuer(),user.subject(),user.username(),request.clientId,token,now+LEASE_MILLIS,datasetId,seriesId);
            } else if("renew".equals(request.action)||"release".equals(request.action)) {
                if(!ours||room.expiresAt<=now||!Objects.equals(room.leaseId,request.leaseId))
                    throw locked("编辑权已过期，本机草稿已保留，请重新申请");
                db.update("UPDATE mask_rooms SET expires_at=? WHERE dataset_id=? AND series_id=?",
                        "release".equals(request.action)?0:now+LEASE_MILLIS,datasetId,seriesId);
            } else throw bad("未知编辑权操作");
            return view(room(datasetId,seriesId),request.clientId,user);
        });
    }

    private List<SliceLease> slices(String datasetId,String seriesId,String clientId,DemoSession.Identity user) {
        return db.query("SELECT * FROM mask_slice_leases WHERE dataset_id=? AND series_id=? AND expires_at>? ORDER BY instance_id",
                (r,n)->{boolean ours=Objects.equals(r.getString("holder_issuer"),user.issuer())
                        &&Objects.equals(r.getString("holder_subject"),user.subject())&&Objects.equals(r.getString("client_id"),clientId);
                    return new SliceLease(r.getString("instance_id"),ours,r.getString("holder_subject"),r.getString("holder_username"),
                            ours?r.getString("lease_id"):null,Instant.ofEpochMilli(r.getLong("expires_at")).toString());},
                datasetId,seriesId,System.currentTimeMillis());
    }

    /** Acquire every affected source image atomically, before a brush can change the local labelmap. */
    public List<SliceLease> sliceLease(String datasetId,String seriesId,SliceRequest request,DemoSession.Identity user) {
        if(request==null||request.instanceIds==null||request.instanceIds.isEmpty()||request.instanceIds.size()>2048)
            throw bad("请选择有效的 CT 切片");
        checkedId(request.clientId);
        return tx.execute(ignored->{
            datasets.requireDatasetAccess(datasetId,user,true);
            Room room=ensureRoom(datasetId,seriesId,user);
            long now=System.currentTimeMillis();
            if(room.expiresAt>now) throw locked("旧页面仍持有序列编辑权，请先释放或等待到期");
            var allowed=new HashSet<String>();
            for(var source:json.readValue(room.sourceJson,DicomSegCodec.SourceImage[].class)) allowed.add(source.id());
            var ids=new LinkedHashSet<>(request.instanceIds);
            if(ids.stream().anyMatch(id->id==null||!allowed.contains(id))) throw bad("编辑权包含当前序列以外的切片");
            var live=slices(datasetId,seriesId,request.clientId,user);
            String token=live.stream().filter(SliceLease::heldBySelf).map(SliceLease::leaseId).findFirst().orElse(UUID.randomUUID().toString());
            for(String id:ids) {
                var old=live.stream().filter(s->s.instanceId.equals(id)).findFirst().orElse(null);
                if("acquire".equals(request.action)) {
                    if(old!=null&&!old.heldBySelf) throw locked("此 CT 切片由 "+old.username+" 正在编辑，可切换到其他切片");
                    db.update("INSERT INTO mask_slice_leases (dataset_id,series_id,instance_id,expires_at,modified_seq) "
                            + "SELECT ?,?,?,0,? WHERE NOT EXISTS (SELECT 1 FROM mask_slice_leases WHERE dataset_id=? AND series_id=? AND instance_id=?)",
                            datasetId,seriesId,id,room.seq,datasetId,seriesId,id);
                    db.update("UPDATE mask_slice_leases SET holder_issuer=?,holder_subject=?,holder_username=?,client_id=?,lease_id=?,expires_at=? "
                            + "WHERE dataset_id=? AND series_id=? AND instance_id=?",user.issuer(),user.subject(),user.username(),request.clientId,token,now+LEASE_MILLIS,datasetId,seriesId,id);
                } else if("renew".equals(request.action)||"release".equals(request.action)) {
                    if(old==null||!old.heldBySelf||!Objects.equals(old.leaseId,request.leaseId)) throw locked("切片编辑权已过期，请重新同步");
                    db.update("UPDATE mask_slice_leases SET expires_at=? WHERE dataset_id=? AND series_id=? AND instance_id=?",
                            "release".equals(request.action)?0:now+LEASE_MILLIS,datasetId,seriesId,id);
                } else throw bad("未知编辑权操作");
            }
            return slices(datasetId,seriesId,request.clientId,user);
        });
    }

    public List<Committed> commit(String datasetId,String seriesId,Batch request,DemoSession.Identity user) {
        if(request==null||request.operations==null||request.operations.isEmpty()||request.operations.size()>16)
            throw bad("每批需包含 1 至 16 条操作");
        checkedId(request.clientId);
        if(json.writeValueAsBytes(request).length>1024*1024) throw new ApiException(HttpStatus.PAYLOAD_TOO_LARGE,"操作批次超过 1 MiB，请拆分");
        return tx.execute(ignored -> {
            datasets.requireDatasetAccess(datasetId,user,true);
            Room room=ensureRoom(datasetId,seriesId,user);
            long seq=room.seq;
            var data=room.data;
            var result=new ArrayList<Committed>();
            var source=json.readValue(room.sourceJson,DicomSegCodec.SourceImage[].class);
            for(var operation:request.operations) {
                if(operation==null) throw bad("操作为空");
                checkedId(operation.clientOpId);
                if(operation.baseSeq<0||operation.segments==null||operation.masks==null) throw bad("操作格式无效");
                String encoded=json.writeValueAsString(operation),hash=hash(encoded);
                if(encoded.getBytes(StandardCharsets.UTF_8).length>192*1024)
                    throw new ApiException(HttpStatus.PAYLOAD_TOO_LARGE,"单条操作超过 192 KiB，请拆分");
                var existing=db.query("SELECT * FROM mask_ops WHERE dataset_id=? AND series_id=? AND client_op_id=?",
                        (r,n)->Map.of("issuer",r.getString("author_issuer"),"subject",r.getString("author_subject"),"hash",r.getString("request_hash"),
                                "seq",r.getLong("seq"),"username",r.getString("author_username"),"at",r.getString("created_at")),
                        datasetId,seriesId,operation.clientOpId);
                if(!existing.isEmpty()) {
                    var old=existing.getFirst();
                    if(!old.get("issuer").equals(user.issuer())||!old.get("subject").equals(user.subject())||!old.get("hash").equals(hash))
                        throw conflict("操作编号已用于其他内容或账户");
                    result.add(new Committed((Long)old.get("seq"),operation.clientOpId,user.subject(),(String)old.get("username"),operation,(String)old.get("at")));
                    continue;
                }
                if(Boolean.TRUE.equals(request.sliced)) {
                    if(operation.baseSeq>seq) throw conflict("操作游标超出当前序列");
                    var affected=new HashSet<String>();
                    operation.masks.forEach(m->{if(m!=null) affected.add(m.instanceId());});
                    boolean definitionsChanged=!data.segments().equals(operation.segments);
                    if(definitionsChanged) for(var image:source) affected.add(image.id());
                    var live=slices(datasetId,seriesId,request.clientId,user);
                    for(String id:affected) {
                        var held=live.stream().filter(s->s.instanceId.equals(id)&&s.heldBySelf&&Objects.equals(s.leaseId,request.leaseId)).findFirst();
                        if(held.isEmpty()) throw locked("没有此 CT 切片的有效编辑权，修改已保留在本机");
                        var changed=db.queryForObject("SELECT COUNT(*) FROM mask_slice_leases WHERE dataset_id=? AND series_id=? AND instance_id=? "
                                + "AND modified_seq>? AND (writer_lease IS NULL OR writer_lease<>?)",Integer.class,datasetId,seriesId,id,operation.baseSeq,request.leaseId);
                        if(changed>0) throw conflict("此切片在离线期间已有其他修改，请先保留草稿并加载共享版本");
                    }
                    // Metadata changes affect every slice, even when this operation changes no pixels.
                    if(definitionsChanged&&operation.baseSeq!=seq) throw conflict("标签定义已变化，请先同步标签");
                } else {
                    if(!owns(room,request.clientId,user)||room.expiresAt<=System.currentTimeMillis()||!Objects.equals(request.leaseId,room.leaseId))
                        throw locked("没有有效编辑权，操作保留在本机，请重新同步后申请编辑");
                    if(operation.baseSeq!=seq) throw conflict("共同画布已变化，旧草稿不能自动覆盖，请保留草稿并重新同步");
                }
                data=apply(data,operation,Arrays.asList(source));
                seq++;
                for(var patch:operation.masks) db.update("UPDATE mask_slice_leases SET modified_seq=?,writer_lease=? WHERE dataset_id=? AND series_id=? AND instance_id=?",
                        seq,request.leaseId,datasetId,seriesId,patch.instanceId());
                if(!room.data.segments().equals(operation.segments)) db.update("UPDATE mask_slice_leases SET modified_seq=?,writer_lease=? WHERE dataset_id=? AND series_id=?",
                        seq,request.leaseId,datasetId,seriesId);
                String at=Instant.now().toString();
                db.update("INSERT INTO mask_ops VALUES (?,?,?,?,?,?,?,?,?,?)",datasetId,seriesId,seq,operation.clientOpId,
                        user.issuer(),user.subject(),user.username(),hash,encoded,at);
                // Same transaction as the receipt: retries and rolled-back batches cannot inflate activity.
                activity.record(datasetId,seriesId,seq,user,operation,at);
                result.add(new Committed(seq,operation.clientOpId,user.subject(),user.username(),operation,at));
            }
            if(seq!=room.seq) db.update("UPDATE mask_rooms SET seq=?,data_json=? WHERE dataset_id=? AND series_id=?",
                    seq,json.writeValueAsString(data),datasetId,seriesId);
            return List.copyOf(result);
        });
    }

    private DicomSegCodec.Labelmap apply(DicomSegCodec.Labelmap current,Operation operation,List<DicomSegCodec.SourceImage> sources) {
        if(operation.masks.size()>2048) throw bad("切片数量过多");
        var allowed=new HashMap<String,DicomSegCodec.SourceImage>(); sources.forEach(s->allowed.put(s.id(),s));
        var masks=new HashMap<String,List<Integer>>(); current.masks().forEach(m->masks.put(m.instanceId(),m.runs()));
        var numbers=new HashSet<Integer>(); operation.segments.forEach(s->{if(s!=null) numbers.add(s.number());});
        var seen=new HashSet<String>();
        for(var patch:operation.masks) {
            if(patch==null||!allowed.containsKey(patch.instanceId())||!seen.add(patch.instanceId())||patch.runs()==null||patch.runs().size()%3!=0)
                throw bad("修改包含无效切片或游程");
            var source=allowed.get(patch.instanceId());
            int[] pixels=new int[Math.multiplyExact(source.rows(),source.columns())];
            var before=masks.getOrDefault(patch.instanceId(),List.of());
            for(int i=0;i<before.size();i+=3) Arrays.fill(pixels,before.get(i),before.get(i)+before.get(i+1),before.get(i+2));
            long end=0;
            for(int i=0;i<patch.runs().size();i+=3) {
                Integer start=patch.runs().get(i),length=patch.runs().get(i+1),number=patch.runs().get(i+2);
                if(start==null||length==null||number==null||start<end||length<=0||start<0||(long)start+length>pixels.length
                        ||(number!=0&&!numbers.contains(number))) throw bad("修改体素越界、重叠或标签不存在");
                Arrays.fill(pixels,start,start+length,number); end=(long)start+length;
            }
            var runs=new ArrayList<Integer>();
            for(int start=0;start<pixels.length;) {
                int stop=start+1; while(stop<pixels.length&&pixels[stop]==pixels[start]) stop++;
                if(pixels[start]!=0) {runs.add(start);runs.add(stop-start);runs.add(pixels[start]);} start=stop;
            }
            masks.put(patch.instanceId(),runs);
        }
        return segmentations.checkedLabelmap(new DicomSegCodec.Labelmap(operation.segments,sources.stream()
                .filter(s->!masks.getOrDefault(s.id(),List.of()).isEmpty()).map(s->new DicomSegCodec.Mask(s.id(),masks.get(s.id()))).toList()),sources);
    }

    private Room ensureRoom(String datasetId,String seriesId,DemoSession.Identity user) {
        var sources=segmentations.seriesSources(datasetId,seriesId,user);
        String sourceJson=json.writeValueAsString(sources);
        Room room=room(datasetId,seriesId);
        if(room==null) {
            var baseline=segmentations.labelmap(datasetId,seriesId,user);
            var data=baseline.data().segments().isEmpty()?new DicomSegCodec.Labelmap(
                    List.of(new DicomSegCodec.Segment(1,"手绘区域",List.of(255,80,80))),List.of()):baseline.data();
            db.update("INSERT INTO mask_rooms (dataset_id,series_id,seq,through_seq,published_version,data_json,sources_json,expires_at,archived_at,archive_error) "
                    + "VALUES (?,?,0,0,?,?,?,0,?,'')",datasetId,seriesId,baseline.status().publishedVersion(),json.writeValueAsString(data),sourceJson,System.currentTimeMillis());
            room=room(datasetId,seriesId);
        }
        if(!room.sourceJson.equals(sourceJson)) throw conflict("源影像清单已变化，不能将旧掩码应用到新的体素网格");
        return room;
    }

    private Room room(String datasetId,String seriesId) {
        var rows=db.query("SELECT * FROM mask_rooms WHERE dataset_id=? AND series_id=?",
                (r,n)->new Room(r.getLong("seq"),r.getLong("through_seq"),r.getLong("published_version"),
                        json.readValue(r.getString("data_json"),DicomSegCodec.Labelmap.class),r.getString("sources_json"),
                        r.getString("holder_issuer"),r.getString("holder_subject"),r.getString("holder_username"),r.getString("client_id"),
                        r.getString("lease_id"),r.getLong("expires_at"),r.getLong("archived_at"),r.getString("archive_error")),datasetId,seriesId);
        return rows.isEmpty()?null:rows.getFirst();
    }

    private static boolean owns(Room room,String clientId,DemoSession.Identity user) {
        return Objects.equals(room.holderIssuer,user.issuer())&&Objects.equals(room.holderSubject,user.subject())&&Objects.equals(room.clientId,clientId);
    }
    private static Lease view(Room room,String clientId,DemoSession.Identity user) {
        if(room.expiresAt<=System.currentTimeMillis()) return new Lease(false,null,null,null,null);
        boolean self=owns(room,clientId,user);
        return new Lease(self,room.holderSubject,room.holderUsername,self?room.leaseId:null,Instant.ofEpochMilli(room.expiresAt).toString());
    }

    /** Runs on the scheduler, never on the browser's save request. Failed jobs are retried intact. */
    @Scheduled(fixedDelayString="${app.collaboration.scan-ms:1000}")
    void archiveDue() {
        var rooms=db.query("SELECT dataset_id,series_id FROM mask_rooms WHERE seq>through_seq AND (archived_at<=? OR seq-through_seq>=?)",
                (r,n)->List.of(r.getString(1),r.getString(2)),System.currentTimeMillis()-archiveMillis,archiveOperations);
        for(var ids:rooms) archive(ids.get(0),ids.get(1));
    }

    public void archive(String datasetId,String seriesId) {
        storage.reference(() -> { archiveProtected(datasetId,seriesId); return null; });
    }

    private void archiveProtected(String datasetId,String seriesId) {
        String key=datasetId+":"+seriesId;
        if(!archiving.add(key)) return;
        try {
            Archive plan=tx.execute(ignored->{
                var room=room(datasetId,seriesId);
                if(room==null||room.seq==room.throughSeq) return null;
                var authorRows=db.query("SELECT author_issuer,author_subject,author_username FROM mask_ops WHERE dataset_id=? AND series_id=? AND seq=?",
                        (r,n)->new DemoSession.Identity(r.getString(1),r.getString(2),r.getString(3)),datasetId,seriesId,room.seq);
                if(authorRows.isEmpty() && room.seq==1) {
                    authorRows=db.query("SELECT baseline_issuer,baseline_subject,baseline_username FROM mask_rooms "
                            + "WHERE dataset_id=? AND series_id=? AND baseline_issuer IS NOT NULL",
                            (r,n)->new DemoSession.Identity(r.getString(1),r.getString(2),r.getString(3)),datasetId,seriesId);
                }
                if(authorRows.isEmpty()) return null;
                var author=authorRows.getFirst();
                datasets.requireDatasetAccess(datasetId,author,true);
                // Re-read after acquiring the same lock as commits.
                room=room(datasetId,seriesId);
                var pending=db.query("SELECT plan_json,orthanc_id FROM mask_snapshot_jobs WHERE dataset_id=? AND series_id=? AND completed=FALSE ORDER BY through_seq LIMIT 1",
                        (r,n)->{var p=json.readValue(r.getString(1),Archive.class);return new Archive(p.datasetId,p.seriesId,p.seq,p.version,p.data,p.sources,p.author,r.getString(2));},datasetId,seriesId);
                if(!pending.isEmpty()) return pending.getFirst();
                var created=new Archive(datasetId,seriesId,room.seq,room.version,room.data,
                        Arrays.asList(json.readValue(room.sourceJson,DicomSegCodec.SourceImage[].class)),author,null);
                db.update("INSERT INTO mask_snapshot_jobs VALUES (?,?,?,?,NULL,FALSE)",datasetId,seriesId,created.seq,json.writeValueAsString(created));
                return created;
            });
            if(plan==null) return;
            String uploaded=plan.orthancId;
            if(uploaded==null) {
                uploaded=segmentations.uploadCollaborativeSnapshot(plan.sources,plan.data);
                db.update("UPDATE mask_snapshot_jobs SET orthanc_id=? WHERE dataset_id=? AND series_id=? AND through_seq=?",uploaded,datasetId,seriesId,plan.seq);
            }
            final String orthancId=uploaded;
            tx.executeWithoutResult(ignored->{
                datasets.requireDatasetAccess(datasetId,plan.author,true);
                long version=segmentations.recordCollaborativeSnapshot(datasetId,seriesId,plan.version,plan.seq,orthancId,plan.author,plan.data.masks().size());
                db.update("UPDATE mask_rooms SET through_seq=?,published_version=?,archived_at=?,archive_error='' WHERE dataset_id=? AND series_id=?",
                        plan.seq,version,System.currentTimeMillis(),datasetId,seriesId);
                db.update("UPDATE mask_snapshot_jobs SET completed=TRUE WHERE dataset_id=? AND series_id=? AND through_seq=?",datasetId,seriesId,plan.seq);
            });
        } catch(RuntimeException exception) {
            // Patient identifiers, payloads and credentials must not reach logs or broadcasts.
            log.warn("Collaboration archive failed: {}",exception.getClass().getSimpleName());
            db.update("UPDATE mask_rooms SET archive_error=?,archived_at=? WHERE dataset_id=? AND series_id=?",
                    "SEG 归档失败，服务器操作已保留，将自动重试",System.currentTimeMillis(),datasetId,seriesId);
        } finally {archiving.remove(key);}
    }

    static void checkedId(String id) {
        if(id==null||!id.matches("[a-zA-Z0-9-]{8,80}")) throw bad("客户端编号格式无效");
    }
    private static String hash(String text) {
        try {return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(text.getBytes(StandardCharsets.UTF_8)));}
        catch(java.security.NoSuchAlgorithmException e) {throw new IllegalStateException(e);}
    }
    private static ApiException bad(String message) {return new ApiException(HttpStatus.BAD_REQUEST,message);}
    private static ApiException conflict(String message) {return new ApiException(HttpStatus.CONFLICT,message);}
    private static ApiException locked(String message) {return new ApiException(HttpStatus.LOCKED,message);}
}
