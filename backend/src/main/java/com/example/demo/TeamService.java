package com.example.demo;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.time.Instant;
import java.util.Base64;
import java.util.HexFormat;
import java.util.List;

import jakarta.annotation.PostConstruct;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

/** Team roles are business data, scoped to a team, never global Keycloak roles. */
@Service
public class TeamService {
    public record TeamItem(String id, String name, String leaderSubject, String leaderUsername,
                           long memberCount, String role, String createdAt) { }
    public record MemberItem(String subject, String username, String role, String joinedAt) { }
    public record InviteResult(TeamItem team, String inviteCode) { }
    private record Team(String id, String name, String issuer, String leader, String leaderName,
                        String inviteHash, String created, String dissolvedAt, long dissolvedDatasets) { }
    private final JdbcTemplate db;
    private final TransactionTemplate tx;
    private final KeycloakDirectoryService directory;
    private final String issuer;
    private static final SecureRandom RANDOM = new SecureRandom();

    public TeamService(JdbcTemplate db, PlatformTransactionManager manager, KeycloakDirectoryService directory,
            @Value("${keycloak.issuer-uri}") String issuer) {
        this.db = db; this.tx = new TransactionTemplate(manager); this.directory = directory; this.issuer = issuer;
    }

    @PostConstruct
    void initialize() {
        db.execute("CREATE TABLE IF NOT EXISTS teams (id VARCHAR(100) PRIMARY KEY, name VARCHAR(100) NOT NULL, "
                + "user_issuer VARCHAR(600) NOT NULL, leader_subject VARCHAR(200) NOT NULL, leader_username VARCHAR(200) NOT NULL, "
                + "invite_hash VARCHAR(64) NOT NULL, created_at VARCHAR(40) NOT NULL)");
        db.execute("CREATE TABLE IF NOT EXISTS team_members (team_id VARCHAR(100) NOT NULL REFERENCES teams(id), "
                + "user_issuer VARCHAR(600) NOT NULL, user_subject VARCHAR(200) NOT NULL, username VARCHAR(200) NOT NULL, "
                + "joined_at VARCHAR(40) NOT NULL, PRIMARY KEY(team_id,user_issuer,user_subject))");
        db.execute("CREATE INDEX IF NOT EXISTS team_member_lookup ON team_members(user_issuer,user_subject)");
        db.execute("ALTER TABLE teams ADD COLUMN IF NOT EXISTS dissolved_at VARCHAR(40)");
        db.execute("ALTER TABLE teams ADD COLUMN IF NOT EXISTS dissolved_dataset_count BIGINT NOT NULL DEFAULT 0");
    }

    public OrthancService.Items<TeamItem> mine(DemoSession.Identity user) {
        validate(user);
        var items = db.query("SELECT t.* FROM teams t JOIN team_members m ON m.team_id=t.id "
                + "WHERE m.user_issuer=? AND m.user_subject=? AND t.dissolved_at IS NULL ORDER BY t.created_at DESC,t.id", (r,n) -> item(team(r),user), user.issuer(),user.subject());
        return new OrthancService.Items<>(items,items.size());
    }

    public OrthancService.Items<TeamItem> search(String query, DemoSession.Identity user) {
        validate(user);
        String q=query==null?"":query.strip();
        if(q.length()<2 || q.length()>100) throw bad("请输入 2 至 100 个字符的队名或完整团队 ID");
        var items=db.query("SELECT * FROM teams WHERE user_issuer=? AND dissolved_at IS NULL AND (UPPER(id)=UPPER(?) OR LOCATE(LOWER(?),LOWER(name))>0) "
                + "ORDER BY CASE WHEN UPPER(id)=UPPER(?) THEN 0 ELSE 1 END,created_at DESC,id LIMIT 20",
                (r,n)->item(team(r),user),issuer,q,q,q);
        return new OrthancService.Items<>(items,items.size());
    }

    public InviteResult create(String name, DemoSession.Identity user) {
        validate(user); String clean=name(name); String id="TM-"+HexFormat.of().formatHex(random(8)).toUpperCase(java.util.Locale.ROOT);
        String code=code(), created=Instant.now().toString();
        return tx.execute(ignored->{
            db.update("INSERT INTO teams (id,name,user_issuer,leader_subject,leader_username,invite_hash,created_at) VALUES (?,?,?,?,?,?,?)",id,clean,issuer,user.subject(),user.username(),hash(code),created);
            add(id,user.subject(),user.username());
            return new InviteResult(get(id,user),code);
        });
    }

    public TeamItem get(String id, DemoSession.Identity user) { return item(requireMember(id,user,false),user); }

    public TeamItem rename(String id, String name, DemoSession.Identity user) {
        String clean=name(name);
        return tx.execute(ignored->{ requireLeader(id,user); db.update("UPDATE teams SET name=? WHERE id=?",clean,id); return get(id,user); });
    }

    public OrthancService.Items<MemberItem> members(String id, DemoSession.Identity user) {
        Team t=requireMember(id,user,false);
        var items=db.query("SELECT * FROM team_members WHERE team_id=? ORDER BY joined_at,user_subject",(r,n)->new MemberItem(
                r.getString("user_subject"),r.getString("username"),t.leader().equals(r.getString("user_subject"))?"leader":"member",r.getString("joined_at")),id);
        return new OrthancService.Items<>(items,items.size());
    }

    public void addMember(String id, String subject, DemoSession.Identity user) {
        requireLeaderRead(id,user);
        var target=directory.requireUser(subject);
        tx.executeWithoutResult(ignored->{requireLeader(id,user);add(id,target.subject(),target.username());});
    }

    public void removeMember(String id, String subject, DemoSession.Identity user) {
        tx.executeWithoutResult(ignored->{
            Team t=requireLeader(id,user);
            if(t.leader().equals(subject)) throw conflict("组长不能移除自己，请先移交组长");
            db.update("DELETE FROM team_members WHERE team_id=? AND user_issuer=? AND user_subject=?",id,issuer,subject);
        });
    }

    public void leave(String id, DemoSession.Identity user) {
        tx.executeWithoutResult(ignored->{
            Team t=requireMember(id,user,true);
            if(t.leader().equals(user.subject())) throw conflict("组长请先移交组长，再退出团队");
            db.update("DELETE FROM team_members WHERE team_id=? AND user_issuer=? AND user_subject=?",id,issuer,user.subject());
        });
    }

    public TeamItem transfer(String id, String subject, DemoSession.Identity user) {
        return tx.execute(ignored->{
            requireLeader(id,user);
            var names=db.query("SELECT username FROM team_members WHERE team_id=? AND user_issuer=? AND user_subject=?",(r,n)->r.getString(1),id,issuer,subject);
            if(names.isEmpty()) throw bad("只能将组长移交给当前团队成员");
            db.update("UPDATE teams SET leader_subject=?,leader_username=? WHERE id=?",subject,names.getFirst(),id);
            return get(id,user);
        });
    }

    public InviteResult rotateCode(String id, DemoSession.Identity user) {
        return tx.execute(ignored->{
            requireLeader(id,user); String code=code(); db.update("UPDATE teams SET invite_hash=? WHERE id=?",hash(code),id);
            return new InviteResult(get(id,user),code);
        });
    }

    public TeamItem join(String id, String code, DemoSession.Identity user) {
        validate(user);
        if(id==null || code==null || code.length()>100 || id.length()>100) throw bad("请填写团队 ID 和邀请码");
        String normalized=id.strip().toUpperCase(java.util.Locale.ROOT);
        return tx.execute(ignored->{
            Team t=load(normalized,true);
            if(!issuer.equals(t.issuer()) || !MessageDigest.isEqual(t.inviteHash().getBytes(StandardCharsets.US_ASCII),hash(code.strip()).getBytes(StandardCharsets.US_ASCII)))
                throw new ApiException(HttpStatus.NOT_FOUND,"团队不存在或邀请码无效");
            add(normalized,user.subject(),user.username());return get(normalized,user);
        });
    }

    /** Lock the team before dataset rows to serialize membership changes with writes. */
    public void requireMembership(String id, DemoSession.Identity user, boolean lock) { requireMember(id,user,lock); }

    /** Null means active; a count means this original leader's DELETE already committed. */
    Long lockDissolution(String id, DemoSession.Identity user) {
        validate(user);
        Team t=loadIncludingDissolved(id,true);
        if(!issuer.equals(t.issuer())) throw unavailable();
        if(!t.leader().equals(user.subject())) {
            if(t.dissolvedAt()==null && member(id,user))
                throw new ApiException(HttpStatus.FORBIDDEN,"只有本队组长可以解散团队");
            throw unavailable();
        }
        return t.dissolvedAt()==null?null:t.dissolvedDatasets();
    }

    void finishDissolution(String id, long datasets) {
        db.update("UPDATE teams SET dissolved_at=?,dissolved_dataset_count=? WHERE id=?",Instant.now().toString(),datasets,id);
        db.update("DELETE FROM team_members WHERE team_id=?",id);
    }

    long requireDissolutionOwner(String id,DemoSession.Identity user) {
        validate(user);
        Team t=loadIncludingDissolved(id,false);
        if(t.dissolvedAt()==null || !issuer.equals(t.issuer()) || !t.leader().equals(user.subject())) throw unavailable();
        return t.dissolvedDatasets();
    }

    private Team requireMember(String id, DemoSession.Identity user, boolean lock) {
        validate(user); Team t=load(id,lock);
        if(!issuer.equals(t.issuer()) || !member(id,user)) throw unavailable();
        return t;
    }
    private Team requireLeader(String id, DemoSession.Identity user) {
        Team t=requireMember(id,user,true);
        if(!t.leader().equals(user.subject())) throw new ApiException(HttpStatus.FORBIDDEN,"只有本队组长可以执行此操作");return t;
    }
    private void requireLeaderRead(String id, DemoSession.Identity user) {
        Team t=requireMember(id,user,false);
        if(!t.leader().equals(user.subject())) throw new ApiException(HttpStatus.FORBIDDEN,"只有本队组长可以执行此操作");
    }
    private boolean member(String id, DemoSession.Identity user) {
        return db.queryForObject("SELECT COUNT(*) FROM team_members WHERE team_id=? AND user_issuer=? AND user_subject=?",Integer.class,id,user.issuer(),user.subject())>0;
    }
    private Team load(String id,boolean lock) {
        Team t=loadIncludingDissolved(id,lock);
        if(t.dissolvedAt()!=null) throw unavailable();
        return t;
    }
    private Team loadIncludingDissolved(String id,boolean lock) {
        var rows=db.query("SELECT * FROM teams WHERE id=?"+(lock?" FOR UPDATE":""),(r,n)->team(r),id);
        if(rows.isEmpty()) throw unavailable();return rows.getFirst();
    }
    private TeamItem item(Team t,DemoSession.Identity user) {
        return new TeamItem(t.id(),t.name(),t.leader(),t.leaderName(),db.queryForObject("SELECT COUNT(*) FROM team_members WHERE team_id=?",Long.class,t.id()),
                t.leader().equals(user.subject())?"leader":member(t.id(),user)?"member":"none",t.created());
    }
    private static Team team(java.sql.ResultSet r) throws java.sql.SQLException {
        return new Team(r.getString("id"),r.getString("name"),r.getString("user_issuer"),r.getString("leader_subject"),r.getString("leader_username"),r.getString("invite_hash"),r.getString("created_at"),r.getString("dissolved_at"),r.getLong("dissolved_dataset_count"));
    }
    private void add(String id,String subject,String username) {
        if(db.queryForObject("SELECT COUNT(*) FROM team_members WHERE team_id=? AND user_issuer=? AND user_subject=?",Integer.class,id,issuer,subject)==0)
            db.update("INSERT INTO team_members VALUES (?,?,?,?,?)",id,issuer,subject,username,Instant.now().toString());
    }
    private void validate(DemoSession.Identity u) {
        if(u==null || !issuer.equals(u.issuer()) || u.subject()==null || u.subject().isBlank()) throw new ApiException(HttpStatus.UNAUTHORIZED,"请使用当前服务器账号登录");
    }
    private static String name(String value) {
        if(value==null || value.isBlank() || value.strip().length()>100) throw bad("队名不能为空，且不能超过 100 个字符");return value.strip();
    }
    private static byte[] random(int length) { byte[] bytes=new byte[length];RANDOM.nextBytes(bytes);return bytes; }
    private static String code() { return Base64.getUrlEncoder().withoutPadding().encodeToString(random(16)); }
    private static String hash(String value) {
        try {return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(value.getBytes(StandardCharsets.UTF_8)));}
        catch(java.security.NoSuchAlgorithmException e){throw new IllegalStateException(e);}
    }
    private static ApiException bad(String text){return new ApiException(HttpStatus.BAD_REQUEST,text);}
    private static ApiException conflict(String text){return new ApiException(HttpStatus.CONFLICT,text);}
    private static ApiException unavailable(){return new ApiException(HttpStatus.NOT_FOUND,"未找到团队或没有访问权限");}
}
