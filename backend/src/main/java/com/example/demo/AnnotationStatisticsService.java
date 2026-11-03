package com.example.demo;

import java.time.Instant;
import java.util.*;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.DependsOn;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.TransactionDefinition;
import org.springframework.transaction.support.TransactionTemplate;
import tools.jackson.databind.json.JsonMapper;

@Service
@DependsOn("annotationStatisticsBackfill")
public class AnnotationStatisticsService {
    public record PersonalStats(int statisticVersion,String countingMethod,String scope,boolean historyIncluded,
            long totalStrokes,long totalAcceptedOperations,long paintOperations,long eraseOperations,long mixedOperations,
            long editedSliceCount,long everPaintedSliceCount,long editedDatasetCount,long editedSeriesCount,
            String firstEditAt,String lastEditAt,String generatedAt) { }
    public record Progress(long totalSlices,long annotatedSlices,long unannotatedSlices,double ratio,double percent) { }
    public record SeriesStats(String datasetId,String seriesId,Progress progress,Progress publishedProgress,
            long seq,long throughSeq,long publishedVersion,boolean pendingArchive,String archiveError) { }
    public record DatasetStats(String datasetId,String completionMethod,int seriesCount,Progress progress,
            Progress publishedProgress,boolean pendingArchive,List<SeriesStats> series,String generatedAt) { }
    private record Publication(long version,Long throughSeq,Integer count) { }
    private record Room(long seq,long throughSeq,long version,String data,String error) { }
    private record Snapshot(Room room,Publication publication) { }
    private final JdbcTemplate db;
    private final DatasetService datasets;
    private final SegmentationService segmentations;
    private final TransactionTemplate read;
    private final String issuer;
    private final JsonMapper json=JsonMapper.builder().build();

    public AnnotationStatisticsService(JdbcTemplate db,DatasetService datasets,SegmentationService segmentations,
            PlatformTransactionManager manager,@Value("${keycloak.issuer-uri}") String issuer) {
        this.db=db;this.datasets=datasets;this.segmentations=segmentations;this.issuer=issuer;
        read=new TransactionTemplate(manager);
        read.setReadOnly(true);
        read.setIsolationLevel(TransactionDefinition.ISOLATION_REPEATABLE_READ);
    }

    public PersonalStats personal(DemoSession.Identity user) {
        if(user==null||!issuer.equals(user.issuer())||user.subject()==null||user.subject().isBlank())
            throw new ApiException(HttpStatus.UNAUTHORIZED,"请重新登录");
        return read.execute(ignored->{
            var totals=db.queryForMap("SELECT COUNT(*) AS accepted,COALESCE(SUM(mask_edit),0) AS edits,COALESCE(SUM(paints),0) AS paints,"
                    + "COALESCE(SUM(erases),0) AS erases,COALESCE(SUM(paints*erases),0) AS mixed,"
                    + "MIN(CASE WHEN mask_edit=1 THEN created_at END) AS first_at,MAX(CASE WHEN mask_edit=1 THEN created_at END) AS last_at "
                    + "FROM annotation_activity_ops WHERE author_issuer=? AND author_subject=?",user.issuer(),user.subject());
            var slices=db.queryForMap("SELECT COUNT(*) AS edited,COALESCE(SUM(CASE WHEN ever_painted THEN 1 ELSE 0 END),0) AS painted "
                    + "FROM annotation_activity_slices WHERE author_issuer=? AND author_subject=?",user.issuer(),user.subject());
            long datasetCount=db.queryForObject("SELECT COUNT(DISTINCT dataset_id) FROM annotation_activity_ops WHERE author_issuer=? AND author_subject=? AND mask_edit=1",
                    Long.class,user.issuer(),user.subject());
            long seriesCount=db.queryForObject("SELECT COUNT(*) FROM (SELECT DISTINCT dataset_id,series_id FROM annotation_activity_ops WHERE author_issuer=? AND author_subject=? AND mask_edit=1) s",
                    Long.class,user.issuer(),user.subject());
            return new PersonalStats(1,"accepted-mask-edit-operation","server-accepted-collaboration-history",true,
                    number(totals,"edits"),number(totals,"accepted"),number(totals,"paints"),number(totals,"erases"),number(totals,"mixed"),
                    number(slices,"edited"),number(slices,"painted"),datasetCount,seriesCount,
                    (String)totals.get("first_at"),(String)totals.get("last_at"),Instant.now().toString());
        });
    }

    public DatasetStats dataset(String datasetId,DemoSession.Identity user) {
        var sources=segmentations.sources(datasetId,user).items(); // Checks current access before touching Orthanc.
        var groups=new LinkedHashMap<String,List<DicomSegCodec.SourceImage>>();
        for(var image:sources) groups.computeIfAbsent(image.seriesId(),id->new ArrayList<>()).add(image);
        var series=new ArrayList<SeriesStats>();
        for(var group:groups.entrySet()) series.add(series(datasetId,group.getKey(),group.getValue(),user));
        // Every series is individually consistent. Totals weight slices; they never average percentages.
        return new DatasetStats(datasetId,"nonempty-mask-slices/ct-slices",series.size(),
                progress(series.stream().mapToLong(s->s.progress.totalSlices).sum(),series.stream().mapToLong(s->s.progress.annotatedSlices).sum()),
                progress(series.stream().mapToLong(s->s.publishedProgress.totalSlices).sum(),series.stream().mapToLong(s->s.publishedProgress.annotatedSlices).sum()),
                series.stream().anyMatch(SeriesStats::pendingArchive),List.copyOf(series),Instant.now().toString());
    }

    public SeriesStats series(String datasetId,String seriesId,DemoSession.Identity user) {
        return series(datasetId,seriesId,segmentations.seriesSources(datasetId,seriesId,user),user);
    }

    private SeriesStats series(String datasetId,String seriesId,List<DicomSegCodec.SourceImage> sources,DemoSession.Identity user) {
        for(int attempt=0;attempt<3;attempt++) {
            var snapshot=read.execute(ignored->{
                datasets.requireDatasetAccess(datasetId,user,false);
                var publications=db.query("SELECT version,through_seq,annotated_slice_count FROM segmentation_publications WHERE dataset_id=? AND series_id=? ORDER BY version DESC LIMIT 1",
                        (r,n)->new Publication(r.getLong(1),(Long)r.getObject(2),(Integer)r.getObject(3)),datasetId,seriesId);
                var rooms=db.query("SELECT seq,through_seq,published_version,data_json,archive_error FROM mask_rooms WHERE dataset_id=? AND series_id=?",
                        (r,n)->new Room(r.getLong(1),r.getLong(2),r.getLong(3),r.getString(4),r.getString(5)),datasetId,seriesId);
                return new Snapshot(rooms.isEmpty()?null:rooms.getFirst(),publications.isEmpty()?null:publications.getFirst());
            });
            var publication=snapshot.publication;
            if(publication!=null&&publication.count==null) {
                // Only the old current SEG needs a one-time decode, outside the database transaction.
                // labelmap() handles a concurrent publication/removal by reloading the latest file.
                var saved=segmentations.labelmap(datasetId,seriesId,user);
                segmentations.cacheSliceCount(datasetId,seriesId,saved.status().publishedVersion(),saved.data().masks().size());
                continue;
            }
            long published=publication==null?0:publication.count;
            var room=snapshot.room;
            long current=published;
            if(room!=null) {
                Set<String> allowed=new HashSet<>();sources.forEach(s->allowed.add(s.id()));
                current=json.readValue(room.data,DicomSegCodec.Labelmap.class).masks().stream()
                        .filter(m->allowed.contains(m.instanceId())&&!m.runs().isEmpty()).map(DicomSegCodec.Mask::instanceId).distinct().count();
            }
            return new SeriesStats(datasetId,seriesId,progress(sources.size(),current),progress(sources.size(),published),
                    room==null?0:room.seq,room==null?0:room.throughSeq,publication==null?0:publication.version,
                    room!=null&&room.seq>room.throughSeq,room==null?"":room.error);
        }
        throw new ApiException(HttpStatus.LOCKED,"掩码版本正在更新，请稍后读取统计");
    }

    private static long number(Map<String,Object> row,String key) {return ((Number)row.get(key)).longValue();}
    private static Progress progress(long total,long annotated) {
        double ratio=total==0?0:(double)annotated/total;
        return new Progress(total,annotated,total-annotated,ratio,Math.round(ratio*10000d)/100d);
    }
}
