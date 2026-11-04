package com.example.demo;

import jakarta.annotation.PostConstruct;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.UUID;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

/** Account-owned references only. Imaging and annotation contents never enter these tables. */
@Service
public class HomeActivityService {
    public record DatasetSummary(String id, String name, String access, String scope, String ownerUsername,
            long instanceCount, String createdAt, String teamId, String teamName) { }
    public record FavoriteItem(DatasetSummary dataset, String favoritedAt) { }
    public record RecentItem(DatasetSummary dataset, String lastOpenedAt) { }
    public record Page<T>(List<T> items, long total, int page, int size) { }
    public record RecentPage(List<RecentItem> items, long total, int page, int size, String generation,
            int retentionDays, int maxItems) { }
    public record RecentContext(String generation, int retentionDays, int maxItems, String expiresAt) { }
    public record FavoriteState(String datasetId, boolean favorited, String favoritedAt) { }
    public record FavoriteResult(boolean success, String datasetId, boolean favorited, String favoritedAt) { }
    public record OpenResult(boolean success, String datasetId, String lastOpenedAt, boolean duplicate) { }
    public record ClearResult(boolean success, String generation) { }
    static final class Failure extends RuntimeException {
        final HttpStatus status; final String code;
        Failure(HttpStatus status, String code, String message) { super(message); this.status=status; this.code=code; }
    }
    private record Account(String generation, long startedAt) { }
    private static final String USER = "user_issuer=? AND user_subject=?";
    private static final long CONTEXT_MS = Duration.ofHours(24).toMillis();
    private static final String FROM = " FROM datasets d LEFT JOIN dataset_teams dt ON dt.dataset_id=d.id "
            + "LEFT JOIN teams t ON t.id=dt.team_id ";
    private static final String SUMMARY = "d.*,dt.team_id,t.name AS team_name,"
            + "(SELECT COUNT(*) FROM dataset_instances i WHERE i.dataset_id=d.id) AS instance_count";
    private final JdbcTemplate db;
    private final TransactionTemplate tx;
    private final DatasetService datasets;
    private final int retentionDays;
    private final int maxItems;
    private final Clock clock;

    @Autowired
    public HomeActivityService(JdbcTemplate db, PlatformTransactionManager manager, DatasetService datasets,
            @Value("${app.home-activity.recent-retention-days:90}") int retentionDays,
            @Value("${app.home-activity.recent-max-items:100}") int maxItems) {
        this(db,manager,datasets,retentionDays,maxItems,Clock.systemUTC());
    }
    HomeActivityService(JdbcTemplate db, PlatformTransactionManager manager, DatasetService datasets,
            int retentionDays, int maxItems, Clock clock) {
        if (retentionDays<1 || retentionDays>3650 || maxItems<1 || maxItems>1000)
            throw new IllegalArgumentException("Invalid recent-history retention policy");
        this.db=db; this.tx=new TransactionTemplate(manager); this.datasets=datasets;
        this.retentionDays=retentionDays; this.maxItems=maxItems; this.clock=clock;
    }

    @PostConstruct
    void initialize() {
        db.execute("CREATE TABLE IF NOT EXISTS home_activity_accounts (user_issuer VARCHAR(600) NOT NULL, "
                + "user_subject VARCHAR(200) NOT NULL, generation VARCHAR(36) NOT NULL, generation_started BIGINT NOT NULL, "
                + "open_sequence BIGINT NOT NULL DEFAULT 0, PRIMARY KEY(user_issuer,user_subject))");
        db.execute("CREATE TABLE IF NOT EXISTS dataset_favorites (user_issuer VARCHAR(600) NOT NULL, "
                + "user_subject VARCHAR(200) NOT NULL, dataset_id VARCHAR(100) NOT NULL REFERENCES datasets(id), "
                + "favorited_at BIGINT NOT NULL, PRIMARY KEY(user_issuer,user_subject,dataset_id))");
        db.execute("CREATE INDEX IF NOT EXISTS favorite_order ON dataset_favorites(user_issuer,user_subject,favorited_at)");
        db.execute("CREATE TABLE IF NOT EXISTS dataset_recent_opens (user_issuer VARCHAR(600) NOT NULL, "
                + "user_subject VARCHAR(200) NOT NULL, dataset_id VARCHAR(100) NOT NULL REFERENCES datasets(id), "
                + "last_opened_at BIGINT NOT NULL, open_sequence BIGINT NOT NULL, PRIMARY KEY(user_issuer,user_subject,dataset_id))");
        db.execute("CREATE INDEX IF NOT EXISTS recent_open_order ON dataset_recent_opens(user_issuer,user_subject,open_sequence)");
        db.execute("CREATE TABLE IF NOT EXISTS dataset_open_events (user_issuer VARCHAR(600) NOT NULL, "
                + "user_subject VARCHAR(200) NOT NULL, event_id VARCHAR(36) NOT NULL, dataset_id VARCHAR(100) NOT NULL, "
                + "accepted_at BIGINT NOT NULL, PRIMARY KEY(user_issuer,user_subject,event_id))");
    }

    public Page<FavoriteItem> favorites(DemoSession.Identity user, int page, int size) {
        datasets.validateIdentity(user); pagination(page,size);
        return tx.execute(ignored -> {
            String joined=FROM+"JOIN dataset_favorites f ON f.dataset_id=d.id WHERE f.user_issuer=? AND f.user_subject=? AND "+DatasetService.VISIBLE;
            Object[] args=visibleArgs(user);
            long total=db.queryForObject("SELECT COUNT(*)"+joined,Long.class,args);
            var items=db.query("SELECT "+SUMMARY+",f.favorited_at"+joined+" ORDER BY f.favorited_at DESC,d.id LIMIT ? OFFSET ?",
                    (r,n)->new FavoriteItem(summary(r,user),iso(r.getLong("favorited_at"))),append(args,size,(long)page*size));
            return new Page<>(List.copyOf(items),total,page,size);
        });
    }

    public FavoriteResult favorite(String id, DemoSession.Identity user) {
        id(id); datasets.validateIdentity(user);
        return tx.execute(ignored->{
            account(user); datasets.requireDatasetAccess(id,user,true);
            var times=db.query("SELECT favorited_at FROM dataset_favorites WHERE "+USER+" AND dataset_id=?",(r,n)->r.getLong(1),user.issuer(),user.subject(),id);
            long at=times.isEmpty()?clock.millis():times.getFirst();
            if(times.isEmpty()) db.update("INSERT INTO dataset_favorites VALUES (?,?,?,?)",user.issuer(),user.subject(),id,at);
            return new FavoriteResult(true,id,true,iso(at));
        });
    }

    /** Removing a personal reference remains possible after losing dataset access. */
    public FavoriteResult unfavorite(String id, DemoSession.Identity user) {
        id(id); datasets.validateIdentity(user);
        return tx.execute(ignored->{
            account(user);
            db.update("DELETE FROM dataset_favorites WHERE "+USER+" AND dataset_id=?",user.issuer(),user.subject(),id);
            return new FavoriteResult(true,id,false,null);
        });
    }

    public OrthancService.Items<FavoriteState> favoriteStates(List<String> ids, DemoSession.Identity user) {
        datasets.validateIdentity(user);
        if(ids==null || ids.isEmpty() || ids.size()>200) throw bad("请提供 1 至 200 个 datasetId");
        ids.forEach(HomeActivityService::id);
        var unique=ids.stream().distinct().toList();
        String in=String.join(",",Collections.nCopies(unique.size(),"?"));
        var args=new ArrayList<Object>(); args.add(user.issuer());args.add(user.subject());
        Collections.addAll(args,DatasetService.identityArgs(user));args.addAll(unique);
        var items=db.query("SELECT d.id,f.favorited_at FROM datasets d LEFT JOIN dataset_favorites f ON f.dataset_id=d.id "
                +"AND f.user_issuer=? AND f.user_subject=? WHERE "+DatasetService.VISIBLE+" AND d.id IN ("+in+") ORDER BY d.id",
                (r,n)->{Long at=r.getObject("favorited_at",Long.class);return new FavoriteState(r.getString("id"),at!=null,at==null?null:iso(at));},args.toArray());
        return new OrthancService.Items<>(List.copyOf(items),items.size());
    }

    public RecentContext recentContext(DemoSession.Identity user) {
        datasets.validateIdentity(user);
        return tx.execute(ignored->{var a=account(user);return new RecentContext(a.generation(),retentionDays,maxItems,iso(a.startedAt()+CONTEXT_MS));});
    }

    public RecentPage recent(DemoSession.Identity user, int page, int size) {
        datasets.validateIdentity(user);pagination(page,size);
        return tx.execute(ignored->{
            var a=account(user); prune(user);
            String joined=FROM+"JOIN dataset_recent_opens h ON h.dataset_id=d.id WHERE h.user_issuer=? AND h.user_subject=? AND "+DatasetService.VISIBLE;
            Object[] args=visibleArgs(user);
            long total=db.queryForObject("SELECT COUNT(*)"+joined,Long.class,args);
            var items=db.query("SELECT "+SUMMARY+",h.last_opened_at"+joined+" ORDER BY h.open_sequence DESC,d.id LIMIT ? OFFSET ?",
                    (r,n)->new RecentItem(summary(r,user),iso(r.getLong("last_opened_at"))),append(args,size,(long)page*size));
            return new RecentPage(List.copyOf(items),total,page,size,a.generation(),retentionDays,maxItems);
        });
    }

    /** The imaging client calls this only after the authorized target image is usable. */
    public OpenResult opened(String id, String eventId, String generation, DemoSession.Identity user) {
        id(id);String eventKey=uuid(eventId),epoch=uuid(generation);datasets.validateIdentity(user);
        return tx.execute(ignored->{
            var a=account(user);
            if(!a.generation().equals(epoch)) throw new Failure(HttpStatus.CONFLICT,"RECENT_CONTEXT_STALE","打开记录上下文已过期或历史已清理；本次记录未写入");
            datasets.requireDatasetAccess(id,user,true);
            var old=db.query("SELECT dataset_id,accepted_at FROM dataset_open_events WHERE "+USER+" AND event_id=?",
                    (r,n)->new Object[]{r.getString(1),r.getLong(2)},user.issuer(),user.subject(),eventKey);
            if(!old.isEmpty()) {
                if(!id.equals(old.getFirst()[0])) throw new Failure(HttpStatus.CONFLICT,"EVENT_ID_REUSED","eventId 已用于另一份资料");
                return new OpenResult(true,id,iso((Long)old.getFirst()[1]),true);
            }
            long at=clock.millis();
            db.update("UPDATE home_activity_accounts SET open_sequence=open_sequence+1 WHERE "+USER,user.issuer(),user.subject());
            long sequence=db.queryForObject("SELECT open_sequence FROM home_activity_accounts WHERE "+USER,Long.class,user.issuer(),user.subject());
            db.update("INSERT INTO dataset_open_events VALUES (?,?,?,?,?)",user.issuer(),user.subject(),eventKey,id,at);
            db.update("MERGE INTO dataset_recent_opens (user_issuer,user_subject,dataset_id,last_opened_at,open_sequence) "
                    +"KEY(user_issuer,user_subject,dataset_id) VALUES (?,?,?,?,?)",user.issuer(),user.subject(),id,at,sequence);
            prune(user);
            return new OpenResult(true,id,iso(at),false);
        });
    }

    public ClearResult clearRecent(String id, DemoSession.Identity user) {
        if(id!=null) id(id);datasets.validateIdentity(user);
        return tx.execute(ignored->{
            account(user);
            db.update("DELETE FROM dataset_recent_opens WHERE "+USER+(id==null?"":" AND dataset_id=?"),
                    id==null?new Object[]{user.issuer(),user.subject()}:new Object[]{user.issuer(),user.subject(),id});
            return new ClearResult(true,rotate(user).generation());
        });
    }

    private Account account(DemoSession.Identity user) {
        // A unique DB row serializes requests across JVMs; generation is never overwritten by an upsert.
        if(db.queryForObject("SELECT COUNT(*) FROM home_activity_accounts WHERE "+USER,Integer.class,user.issuer(),user.subject())==0) {
            try { db.update("INSERT INTO home_activity_accounts (user_issuer,user_subject,generation,generation_started) VALUES (?,?,?,?)",
                    user.issuer(),user.subject(),UUID.randomUUID().toString(),clock.millis()); }
            catch(DuplicateKeyException raced) { /* Another transaction created the same account. */ }
        }
        var a=db.queryForObject("SELECT generation,generation_started FROM home_activity_accounts WHERE "+USER+" FOR UPDATE",
                (r,n)->new Account(r.getString(1),r.getLong(2)),user.issuer(),user.subject());
        if(clock.millis()-a.startedAt()>=CONTEXT_MS) a=rotate(user);
        return a;
    }
    private Account rotate(DemoSession.Identity user) {
        var a=new Account(UUID.randomUUID().toString(),clock.millis());
        db.update("UPDATE home_activity_accounts SET generation=?,generation_started=? WHERE "+USER,a.generation(),a.startedAt(),user.issuer(),user.subject());
        db.update("DELETE FROM dataset_open_events WHERE "+USER,user.issuer(),user.subject());
        return a;
    }
    private void prune(DemoSession.Identity user) {
        db.update("DELETE FROM dataset_recent_opens WHERE "+USER+" AND last_opened_at<=?",user.issuer(),user.subject(),clock.millis()-Duration.ofDays(retentionDays).toMillis());
        db.update("DELETE FROM dataset_recent_opens WHERE "+USER+" AND dataset_id IN (SELECT dataset_id FROM dataset_recent_opens WHERE "+USER
                +" ORDER BY open_sequence DESC,dataset_id OFFSET ? ROWS)",user.issuer(),user.subject(),user.issuer(),user.subject(),maxItems);
    }
    @Scheduled(fixedDelayString="${app.home-activity.cleanup-ms:3600000}", initialDelayString="${app.home-activity.cleanup-ms:3600000}")
    public void cleanupExpired() {
        db.update("DELETE FROM dataset_recent_opens WHERE last_opened_at<=?",clock.millis()-Duration.ofDays(retentionDays).toMillis());
        db.update("DELETE FROM dataset_open_events WHERE accepted_at<=?",clock.millis()-CONTEXT_MS);
    }
    private static DatasetSummary summary(java.sql.ResultSet r, DemoSession.Identity user) throws java.sql.SQLException {
        String teamId=r.getString("team_id");
        boolean owner=user.issuer().equals(r.getString("owner_issuer")) && user.subject().equals(r.getString("owner_subject"));
        return new DatasetSummary(r.getString("id"),r.getString("name"),teamId==null&&r.getBoolean("is_public")?"public":owner?"owner":"shared",
                teamId==null?"personal":"team",r.getString("owner_username"),r.getLong("instance_count"),r.getString("created_at"),teamId,r.getString("team_name"));
    }
    private static Object[] visibleArgs(DemoSession.Identity user) { return append(new Object[]{user.issuer(),user.subject()},DatasetService.identityArgs(user)); }
    private static Object[] append(Object[] initial,Object... tail) { var out=new ArrayList<Object>(List.of(initial));Collections.addAll(out,tail);return out.toArray(); }
    private static void pagination(int page,int size) { if(page<0 || size<1 || size>100) throw bad("page 必须不小于 0，size 必须为 1 至 100"); }
    private static void id(String id) { if(id==null || !id.matches("[A-Za-z0-9][A-Za-z0-9_-]{0,99}")) throw bad("datasetId 格式不正确"); }
    private static String uuid(String value) {
        try { if(value==null || !UUID.fromString(value).toString().equalsIgnoreCase(value)) throw new IllegalArgumentException(); return UUID.fromString(value).toString(); }
        catch(IllegalArgumentException invalid) { throw bad("eventId 和 generation 必须为完整 UUID"); }
    }
    private static String iso(long millis) { return Instant.ofEpochMilli(millis).toString(); }
    private static Failure bad(String message) { return new Failure(HttpStatus.BAD_REQUEST,"INVALID_ACTIVITY_REQUEST",message); }
}
