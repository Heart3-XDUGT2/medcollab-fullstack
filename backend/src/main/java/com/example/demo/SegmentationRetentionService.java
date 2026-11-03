package com.example.demo;

import java.time.Instant;
import java.util.List;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.context.annotation.DependsOn;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;
import org.springframework.transaction.support.TransactionSynchronizationManager;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

/** Latest-only SEG storage. Committed publication receipts form a durable, restart-safe cleanup queue. */
@Service
@DependsOn({"segmentationService", "collaborationService"})
public class SegmentationRetentionService {
    private static final Logger log = LoggerFactory.getLogger(SegmentationRetentionService.class);
    private final JdbcTemplate db;
    private final OrthancService orthanc;
    private final TransactionTemplate transaction;

    public SegmentationRetentionService(JdbcTemplate db, OrthancService orthanc, PlatformTransactionManager manager) {
        this.db = db;
        this.orthanc = orthanc;
        this.transaction = new TransactionTemplate(manager);
    }

    // Runs outside upload/operation transactions: slow deletes never hold the drawing lease or dataset lock.
    // Old rows from previous releases are discovered too; an idle series needs no new publication to clean up.
    @Scheduled(scheduler="segmentationCleanupScheduler", fixedDelayString="${app.segmentation.cleanup-ms:5000}",
            initialDelayString="${app.segmentation.cleanup-ms:5000}")
    public synchronized void cleanupSuperseded() {
        if (TransactionSynchronizationManager.isActualTransactionActive()) return;
        List<String> candidates = db.query("SELECT DISTINCT p.orthanc_id FROM segmentation_publications p "
                + "WHERE p.storage_deleted_at IS NULL "
                + "AND EXISTS (SELECT 1 FROM segmentation_publications n WHERE n.dataset_id=p.dataset_id "
                + "AND n.series_id=p.series_id AND n.version>p.version) "
                + "AND NOT EXISTS (SELECT 1 FROM dataset_instances i WHERE i.instance_id=p.orthanc_id) "
                + "AND NOT EXISTS (SELECT 1 FROM mask_snapshot_jobs j WHERE j.orthanc_id=p.orthanc_id AND j.completed=FALSE) "
                + "AND NOT EXISTS (SELECT 1 FROM segmentation_publications a WHERE a.orthanc_id=p.orthanc_id "
                + "AND NOT EXISTS (SELECT 1 FROM segmentation_publications b WHERE b.dataset_id=a.dataset_id "
                + "AND b.series_id=a.series_id AND b.version>a.version)) "
                + "ORDER BY p.orthanc_id LIMIT 32", (r,n) -> r.getString(1));
        for (String id : candidates) {
            try {
                // Keep the last usable copy if the current replacement has disappeared from Orthanc.
                var replacements = db.query("SELECT DISTINCT n.orthanc_id FROM segmentation_publications p "
                        + "JOIN segmentation_publications n ON n.dataset_id=p.dataset_id AND n.series_id=p.series_id "
                        + "WHERE p.orthanc_id=? AND NOT EXISTS (SELECT 1 FROM segmentation_publications x "
                        + "WHERE x.dataset_id=n.dataset_id AND x.series_id=n.series_id AND x.version>n.version)",
                        (r,n) -> r.getString(1), id);
                if (replacements.isEmpty() || replacements.contains(id)) continue;
                for (String replacement : replacements) orthanc.instanceMetadata(replacement);
                orthanc.deleteSegmentation(id);
                // Mark only after success. A failure or crash is retried; an already missing SEG is success.
                transaction.executeWithoutResult(ignored -> {
                    db.update("UPDATE segmentation_publications SET storage_deleted_at=? "
                            + "WHERE orthanc_id=? AND storage_deleted_at IS NULL", Instant.now().toString(), id);
                    // Completed jobs will never be replayed. Keep their small receipt, discard the obsolete full mask plan.
                    db.update("UPDATE mask_snapshot_jobs SET plan_json='{}' WHERE orthanc_id=? AND completed=TRUE", id);
                });
                log.info("已清理旧 SEG，保留当前最新掩码");
            } catch (RuntimeException exception) {
                log.warn("旧 SEG 清理暂未完成，将自动重试：{}", exception.getClass().getSimpleName());
            }
        }
    }
}
