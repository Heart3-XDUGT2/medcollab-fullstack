package com.example.demo;

import jakarta.annotation.PostConstruct;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;

/** Derived indexes of durable operations. Call inside the operation/backfill transaction. */
@Component
public class AnnotationActivityRecorder {
    private final JdbcTemplate db;
    public AnnotationActivityRecorder(JdbcTemplate db) { this.db=db; }

    @PostConstruct
    void initialize() {
        // Intentionally no dataset FK: a user's lifetime totals survive logical dataset deletion.
        db.execute("CREATE TABLE IF NOT EXISTS annotation_activity_ops (dataset_id VARCHAR(100) NOT NULL, series_id VARCHAR(100) NOT NULL, "
                + "seq BIGINT NOT NULL, author_issuer VARCHAR(600) NOT NULL, author_subject VARCHAR(200) NOT NULL, "
                + "mask_edit INTEGER NOT NULL, paints INTEGER NOT NULL, erases INTEGER NOT NULL, created_at VARCHAR(40) NOT NULL, "
                + "PRIMARY KEY(dataset_id,series_id,seq))");
        db.execute("CREATE INDEX IF NOT EXISTS annotation_activity_author ON annotation_activity_ops(author_issuer,author_subject)");
        db.execute("CREATE TABLE IF NOT EXISTS annotation_activity_slices (author_issuer VARCHAR(600) NOT NULL, author_subject VARCHAR(200) NOT NULL, "
                + "dataset_id VARCHAR(100) NOT NULL, series_id VARCHAR(100) NOT NULL, instance_id VARCHAR(100) NOT NULL, ever_painted BOOLEAN NOT NULL, "
                + "PRIMARY KEY(author_issuer,author_subject,dataset_id,series_id,instance_id))");
    }

    void record(String datasetId,String seriesId,long seq,DemoSession.Identity user,CollaborationService.Operation operation,String at) {
        if(db.queryForObject("SELECT COUNT(*) FROM annotation_activity_ops WHERE dataset_id=? AND series_id=? AND seq=?",
                Integer.class,datasetId,seriesId,seq)>0) return;
        boolean paints=false,erases=false;
        for(var mask:operation.masks()) {
            boolean painted=false;
            for(int i=2;i<mask.runs().size();i+=3) {
                if(mask.runs().get(i)>0) { paints=true;painted=true; } else erases=true;
            }
            if(mask.runs().isEmpty()) continue;
            // Live writers hold the dataset lock; startup backfill is single-threaded before readiness.
            if(db.queryForObject("SELECT COUNT(*) FROM annotation_activity_slices WHERE author_issuer=? AND author_subject=? AND dataset_id=? AND series_id=? AND instance_id=?",
                    Integer.class,user.issuer(),user.subject(),datasetId,seriesId,mask.instanceId())==0)
                db.update("INSERT INTO annotation_activity_slices VALUES (?,?,?,?,?,?)",
                        user.issuer(),user.subject(),datasetId,seriesId,mask.instanceId(),painted);
            if(painted) db.update("UPDATE annotation_activity_slices SET ever_painted=TRUE WHERE author_issuer=? AND author_subject=? AND dataset_id=? AND series_id=? AND instance_id=? AND ever_painted=FALSE",
                    user.issuer(),user.subject(),datasetId,seriesId,mask.instanceId());
        }
        db.update("INSERT INTO annotation_activity_ops VALUES (?,?,?,?,?,?,?,?,?)",datasetId,seriesId,seq,user.issuer(),user.subject(),
                paints||erases?1:0,paints?1:0,erases?1:0,at);
    }
}
