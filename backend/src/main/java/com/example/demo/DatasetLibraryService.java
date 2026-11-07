package com.example.demo;

import java.util.ArrayList;
import java.util.List;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.TransactionDefinition;
import org.springframework.transaction.support.TransactionTemplate;

/** One permission-filtered SQL library, without enumerating Orthanc or every team. */
@Service
public class DatasetLibraryService {
    public record Item(String id, String name, String access, String ownerUsername, long instanceCount,
            String createdAt, String scope, String teamId, String teamName, String uploaderSubject, boolean canDelete) { }
    public record SourceCounts(long personal, long team, long publicCount) {
        @com.fasterxml.jackson.annotation.JsonProperty("public")
        public long publicCount() { return publicCount; }
    }
    public record Page(List<Item> items, long total, int page, int size, SourceCounts sourceCounts) { }
    private static final String FROM = " FROM datasets d LEFT JOIN dataset_teams dt ON dt.dataset_id=d.id "
            + "LEFT JOIN teams t ON t.id=dt.team_id ";
    private static final String PERSONAL = "dt.team_id IS NULL AND d.is_public=FALSE";
    private static final String TEAM = "dt.team_id IS NOT NULL";
    private static final String PUBLIC = "dt.team_id IS NULL AND d.is_public=TRUE";
    private final JdbcTemplate db;
    private final DatasetService datasets;
    private final TeamService teams;
    private final TransactionTemplate read;

    public DatasetLibraryService(JdbcTemplate db, DatasetService datasets, TeamService teams,
            PlatformTransactionManager manager) {
        this.db=db; this.datasets=datasets; this.teams=teams;
        this.read=new TransactionTemplate(manager);
        this.read.setReadOnly(true);
        this.read.setIsolationLevel(TransactionDefinition.ISOLATION_SERIALIZABLE);
    }

    public Page list(DemoSession.Identity user, String source, String teamId, String query,
            int page, int size, String sort) {
        datasets.validateIdentity(user);
        if (!List.of("all","personal","team","public").contains(source)) throw bad("source 必须为 all、personal、team 或 public");
        if (!"created-desc".equals(sort)) throw bad("sort 当前仅支持 created-desc");
        if (page<0 || size<1 || size>100) throw bad("page 必须不小于 0，size 必须为 1 至 100");
        String q=query==null?"":query.strip();
        if (q.length()>100) throw bad("q 不能超过 100 个字符");
        if (teamId!=null && (!List.of("all","team").contains(source) || !teamId.matches("[A-Za-z0-9][A-Za-z0-9_-]{0,99}")))
            throw bad("teamId 仅可用于 source=all/team，且必须为有效团队 ID");
        long offset=Math.multiplyExact((long)page,size);
        return read.execute(ignored -> {
            // Membership, counts and page share one database snapshot.
            if (teamId!=null) teams.requireMembership(teamId,user,false);
            String where=" WHERE "+DatasetService.VISIBLE;
            var args=new ArrayList<Object>(List.of(DatasetService.identityArgs(user)));
            if (teamId!=null) { where+=" AND dt.team_id=?"; args.add(teamId); }
            if (!q.isEmpty()) {
                where+=" AND (LOCATE(LOWER(?),LOWER(d.name))>0 OR LOCATE(LOWER(?),LOWER(d.id))>0 "
                        +"OR LOCATE(LOWER(?),LOWER(COALESCE(d.owner_username,'')))>0)";
                args.add(q); args.add(q); args.add(q);
            }
            SourceCounts counts=db.queryForObject("SELECT "
                    +"COALESCE(SUM(CASE WHEN "+PERSONAL+" THEN 1 ELSE 0 END),0),"
                    +"COALESCE(SUM(CASE WHEN "+TEAM+" THEN 1 ELSE 0 END),0),"
                    +"COALESCE(SUM(CASE WHEN "+PUBLIC+" THEN 1 ELSE 0 END),0)"+FROM+where,
                    (r,n)->new SourceCounts(r.getLong(1),r.getLong(2),r.getLong(3)),args.toArray());
            long total=switch(source) { case "personal"->counts.personal(); case "team"->counts.team();
                case "public"->counts.publicCount(); default->counts.personal()+counts.team()+counts.publicCount(); };
            String selected=switch(source) { case "personal"->PERSONAL; case "team"->TEAM; case "public"->PUBLIC; default->"TRUE"; };
            args.add(size); args.add(offset);
            var items=db.query("SELECT d.*,dt.team_id,t.name AS team_name,"
                    +"(SELECT COUNT(*) FROM dataset_instances i WHERE i.dataset_id=d.id) AS instance_count"
                    +FROM+where+" AND ("+selected+") ORDER BY d.created_at DESC,d.id ASC LIMIT ? OFFSET ?",(r,n)->{
                        String team=r.getString("team_id");
                        boolean owner=user.issuer().equals(r.getString("owner_issuer")) && user.subject().equals(r.getString("owner_subject"));
                        boolean sharedPublic=team==null && r.getBoolean("is_public");
                        return new Item(r.getString("id"),r.getString("name"),sharedPublic?"public":owner?"owner":"shared",
                                r.getString("owner_username"),r.getLong("instance_count"),r.getString("created_at"),
                                team==null?"personal":"team",team,r.getString("team_name"),team==null?null:r.getString("owner_subject"),!sharedPublic&&owner);
                    },args.toArray());
            return new Page(List.copyOf(items),total,page,size,counts);
        });
    }

    private static ApiException bad(String message) { return new ApiException(HttpStatus.BAD_REQUEST,message); }
}
