package com.example.demo;

import static org.assertj.core.api.Assertions.*;
import java.util.concurrent.*;
import org.junit.jupiter.api.Test;

class SegmentationStorageGuardTests {
    @Test void failedWriterReleasesTheReadGuard() {
        var guard=new SegmentationStorageGuard();
        assertThatThrownBy(()->guard.reference(()->{throw new IllegalArgumentException("failed upload");}))
                .isInstanceOf(IllegalArgumentException.class);
        assertThat(guard.cleanupIfIdle(()->{})).isTrue();
    }
    @Test void failedCleanupReleasesTheExclusiveGuard() throws Exception {
        var guard=new SegmentationStorageGuard();
        assertThatThrownBy(()->guard.cleanupIfIdle(()->{throw new IllegalArgumentException("failed delete");}))
                .isInstanceOf(IllegalArgumentException.class);
        try(var executor=Executors.newVirtualThreadPerTaskExecutor()) {
            assertThat(executor.submit(()->guard.reference(()->42)).get(2,TimeUnit.SECONDS)).isEqualTo(42);
        }
    }
    @Test void nestedReferencesDoNotAccidentallyUpgradeIntoDeletion() {
        var guard=new SegmentationStorageGuard();
        guard.reference(()->guard.reference(()->{assertThat(guard.cleanupIfIdle(()->fail("unexpected delete"))).isFalse();return null;}));
        assertThat(guard.cleanupIfIdle(()->{})).isTrue();
    }
    @Test void snapshotHelpersRequireAnExplicitReferenceScope() {
        var guard=new SegmentationStorageGuard();
        assertThatThrownBy(guard::requireReference).isInstanceOf(IllegalStateException.class);
        guard.reference(()->{guard.requireReference();return null;});
    }
}
