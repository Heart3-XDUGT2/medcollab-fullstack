package com.example.demo;

import jakarta.annotation.PostConstruct;
import org.springframework.context.annotation.DependsOn;
import org.springframework.stereotype.Component;

/** Atomically convert legacy grants before any API can serve the new ownership policy. */
@Component
@DependsOn({"collaborationService", "homeActivityService"})
public class DatasetForwardingMigration {
    private final DatasetService datasets;
    public DatasetForwardingMigration(DatasetService datasets) { this.datasets=datasets; }
    @PostConstruct void migrate() { datasets.migrateForwardingShares(); }
}
