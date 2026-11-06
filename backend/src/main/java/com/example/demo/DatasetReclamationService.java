package com.example.demo;

import java.time.Instant;
import org.slf4j.LoggerFactory;
import org.springframework.context.annotation.DependsOn;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

/** Durable, instance-scoped reclamation. Never delete an Orthanc series/study. */
@Service
@DependsOn({"datasetForwardingMigration", "segmentationService", "collaborationService"})
public class DatasetReclamationService {
    public record DeletionResult(boolean success, String datasetId, long deletedObjects, long retainedObjects, long pendingObjects) { }
    private final JdbcTemplate db;
    private final OrthancService orthanc;
    private final SegmentationStorageGuard storage;
    private final TransactionTemplate tx;

    public DatasetReclamationService(JdbcTemplate db,OrthancService orthanc,SegmentationStorageGuard storage,PlatformTransactionManager manager) {
        this.db=db;this.orthanc=orthanc;this.storage=storage;this.tx=new TransactionTemplate(manager);
    }

    @Scheduled(scheduler="segmentationCleanupScheduler",fixedDelayString="${app.datasets.reclamation-ms:5000}",initialDelayString="${app.datasets.reclamation-ms:5000}")
    public synchronized void cleanup() {
        var objects=db.query("SELECT instance_id FROM storage_reclamation WHERE state='pending' ORDER BY requested_at,instance_id LIMIT 32",(r,n)->r.getString(1));
        for(String id:objects) {
            try {
                if(!storage.cleanupIfIdle(()->reclaim(id))) return;
            } catch(RuntimeException failure) {
                db.update("UPDATE storage_reclamation SET attempts=attempts+1 WHERE instance_id=? AND state='pending'",id);
                LoggerFactory.getLogger(getClass()).warn("Dataset storage reclamation pending: {}",failure.getClass().getSimpleName());
            }
        }
    }

    private void reclaim(String id) {
        if(db.queryForObject("SELECT COUNT(*) FROM storage_reclamation WHERE instance_id=? AND state='pending'",Integer.class,id)==0) return;
        boolean held=db.queryForObject("SELECT COUNT(*) FROM dataset_instances i JOIN datasets d ON d.id=i.dataset_id "
                + "WHERE i.instance_id=? AND d.deleted_at IS NULL",Long.class,id)>0
                || db.queryForObject("SELECT COUNT(*) FROM segmentation_publications p JOIN datasets d ON d.id=p.dataset_id "
                + "WHERE p.orthanc_id=? AND d.deleted_at IS NULL AND p.storage_deleted_at IS NULL AND NOT EXISTS "
                + "(SELECT 1 FROM segmentation_publications n WHERE n.dataset_id=p.dataset_id AND n.series_id=p.series_id AND n.version>p.version)",Long.class,id)>0
                || db.queryForObject("SELECT COUNT(*) FROM mask_snapshot_jobs WHERE orthanc_id=? AND completed=FALSE",Long.class,id)>0;
        if(held) {
            db.update("UPDATE storage_reclamation SET state='retained' WHERE instance_id=?",id);
            return;
        }
        // All uploaders/reference writers share this exclusive guard through DELETE + commit.
        orthanc.deleteUnreferencedInstance(id);
        tx.executeWithoutResult(ignored->{
            db.update("UPDATE storage_reclamation SET state='deleted' WHERE instance_id=?",id);
            db.update("UPDATE segmentation_publications SET storage_deleted_at=COALESCE(storage_deleted_at,?) WHERE orthanc_id=?",Instant.now().toString(),id);
            db.update("UPDATE mask_snapshot_jobs SET plan_json='{}' WHERE orthanc_id=? AND completed=TRUE",id);
        });
    }

    public DeletionResult result(String datasetId) {
        return db.queryForObject("SELECT COALESCE(SUM(CASE WHEN r.state='deleted' THEN 1 ELSE 0 END),0),"
                + "COALESCE(SUM(CASE WHEN r.state='retained' THEN 1 ELSE 0 END),0),COALESCE(SUM(CASE WHEN r.state='pending' THEN 1 ELSE 0 END),0) "
                + "FROM dataset_deletion_objects o JOIN storage_reclamation r ON r.instance_id=o.instance_id WHERE o.dataset_id=?",
                (r,n)->new DeletionResult(true,datasetId,r.getLong(1),r.getLong(2),r.getLong(3)),datasetId);
    }
}
