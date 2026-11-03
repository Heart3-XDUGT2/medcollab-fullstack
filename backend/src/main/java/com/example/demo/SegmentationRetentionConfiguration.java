package com.example.demo;

import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.scheduling.concurrent.ThreadPoolTaskScheduler;

@Configuration(proxyBeanMethods=false)
class SegmentationRetentionConfiguration {
    /** Orthanc cleanup timeouts must not occupy the collaboration heartbeat/archive scheduler. */
    @Bean
    ThreadPoolTaskScheduler segmentationCleanupScheduler() {
        var scheduler=new ThreadPoolTaskScheduler();
        scheduler.setPoolSize(1);
        scheduler.setThreadNamePrefix("segmentation-cleanup-");
        return scheduler;
    }
}
