package com.example.demo;

import java.util.concurrent.locks.ReentrantReadWriteLock;
import java.util.function.Supplier;
import org.springframework.stereotype.Component;
import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;

/** Coordinates Orthanc reference creation and deletion within this single JVM. */
@Component
public class SegmentationStorageGuard {
    private final ReentrantReadWriteLock lock = new ReentrantReadWriteLock(true);

    /** Acquire before any dataset lock/upload; retain through the actual database commit. */
    public <T> T reference(Supplier<T> action) {
        var read = lock.readLock();
        read.lock();
        boolean deferred = false;
        try {
            // TransactionTemplate can join an outer transaction. Returning from the inner
            // method does not commit its references; only afterCompletion may release them.
            if (TransactionSynchronizationManager.isActualTransactionActive()) {
                if (!TransactionSynchronizationManager.isSynchronizationActive())
                    throw new IllegalStateException("Storage references require transaction synchronization");
                TransactionSynchronizationManager.registerSynchronization(new TransactionSynchronization() {
                    @Override public void afterCompletion(int status) { read.unlock(); }
                });
                deferred = true;
            }
            return action.get();
        } finally {
            if (!deferred) read.unlock();
        }
    }

    /** A busy upload makes this cleanup tick yield; it never holds dataset locks while waiting. */
    public boolean cleanupIfIdle(Runnable action) {
        if (lock.getReadHoldCount() != 0 || !lock.writeLock().tryLock()) return false;
        try { action.run(); return true; }
        finally { lock.writeLock().unlock(); }
    }

    void requireReference() {
        if (lock.getReadHoldCount() == 0)
            throw new IllegalStateException("Snapshot upload/registration requires a storage reference guard");
    }
}
