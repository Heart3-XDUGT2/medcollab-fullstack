package com.example.demo;

import jakarta.annotation.PostConstruct;
import org.slf4j.LoggerFactory;
import org.springframework.context.annotation.DependsOn;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;
import tools.jackson.databind.json.JsonMapper;

/** Runs before the API becomes ready; resumable in bounded transactions, never reads old SEG files. */
@Component
@DependsOn("collaborationService")
public class AnnotationStatisticsBackfill {
    private final JdbcTemplate db;
    private final TransactionTemplate tx;
    private final AnnotationActivityRecorder recorder;
    private final JsonMapper json=JsonMapper.builder().build();
    public AnnotationStatisticsBackfill(JdbcTemplate db,PlatformTransactionManager manager,AnnotationActivityRecorder recorder) {
        this.db=db;this.tx=new TransactionTemplate(manager);this.recorder=recorder;
    }
    private record Historical(String datasetId,String seriesId,long seq,DemoSession.Identity user,String operation,String at) { }

    @PostConstruct
    void backfill() {
        long total=0;
        while(true) {
            int size=tx.execute(ignored->{
                var rows=db.query("SELECT o.* FROM mask_ops o WHERE NOT EXISTS (SELECT 1 FROM annotation_activity_ops a "
                        + "WHERE a.dataset_id=o.dataset_id AND a.series_id=o.series_id AND a.seq=o.seq) "
                        + "ORDER BY o.dataset_id,o.series_id,o.seq LIMIT 200",
                        (r,n)->new Historical(r.getString("dataset_id"),r.getString("series_id"),r.getLong("seq"),
                                new DemoSession.Identity(r.getString("author_issuer"),r.getString("author_subject"),r.getString("author_username")),
                                r.getString("operation_json"),r.getString("created_at")));
                for(var row:rows) recorder.record(row.datasetId,row.seriesId,row.seq,row.user,
                        json.readValue(row.operation,CollaborationService.Operation.class),row.at);
                return rows.size();
            });
            total+=size;
            if(size<200) break;
        }
        LoggerFactory.getLogger(getClass()).info("Annotation activity backfill ready: {} historical operations indexed",total);
    }
}
