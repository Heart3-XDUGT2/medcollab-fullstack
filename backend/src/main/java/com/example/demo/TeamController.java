package com.example.demo;

import java.util.Map;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.http.CacheControl;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

@RestController
public class TeamController {
    record NameRequest(String name) { }
    record MemberRequest(String subject) { }
    record JoinRequest(String teamId,String inviteCode) { }
    private final TeamService teams;
    private final DatasetService datasets;
    public TeamController(TeamService teams,DatasetService datasets){this.teams=teams;this.datasets=datasets;}

    @GetMapping("/api/teams")
    public ResponseEntity<?> mine(HttpServletRequest r){return ok(teams.mine(DemoSession.requireIdentity(r)));}
    @GetMapping("/api/teams/search")
    public ResponseEntity<?> search(@RequestParam String q,HttpServletRequest r){return ok(teams.search(q,DemoSession.requireIdentity(r)));}
    @PostMapping("/api/teams")
    public ResponseEntity<?> create(@RequestBody NameRequest b,HttpServletRequest r){return ok(teams.create(b.name(),DemoSession.requireIdentity(r)));}
    @PostMapping("/api/teams/join")
    public ResponseEntity<?> join(@RequestBody JoinRequest b,HttpServletRequest r){return ok(teams.join(b.teamId(),b.inviteCode(),DemoSession.requireIdentity(r)));}
    @GetMapping("/api/teams/{id}")
    public ResponseEntity<?> get(@PathVariable String id,HttpServletRequest r){return ok(teams.get(id,DemoSession.requireIdentity(r)));}
    @PatchMapping("/api/teams/{id}")
    public ResponseEntity<?> rename(@PathVariable String id,@RequestBody NameRequest b,HttpServletRequest r){return ok(teams.rename(id,b.name(),DemoSession.requireIdentity(r)));}
    @GetMapping("/api/teams/{id}/members")
    public ResponseEntity<?> members(@PathVariable String id,HttpServletRequest r){return ok(teams.members(id,DemoSession.requireIdentity(r)));}
    @PutMapping("/api/teams/{id}/members")
    public ResponseEntity<?> add(@PathVariable String id,@RequestBody MemberRequest b,HttpServletRequest r){teams.addMember(id,b.subject(),DemoSession.requireIdentity(r));return success();}
    @DeleteMapping("/api/teams/{id}/members/{subject}")
    public ResponseEntity<?> remove(@PathVariable String id,@PathVariable String subject,HttpServletRequest r){teams.removeMember(id,subject,DemoSession.requireIdentity(r));return success();}
    @PostMapping("/api/teams/{id}/leave")
    public ResponseEntity<?> leave(@PathVariable String id,HttpServletRequest r){teams.leave(id,DemoSession.requireIdentity(r));return success();}
    @PostMapping("/api/teams/{id}/transfer")
    public ResponseEntity<?> transfer(@PathVariable String id,@RequestBody MemberRequest b,HttpServletRequest r){return ok(teams.transfer(id,b.subject(),DemoSession.requireIdentity(r)));}
    @PostMapping("/api/teams/{id}/invite-code")
    public ResponseEntity<?> code(@PathVariable String id,HttpServletRequest r){return ok(teams.rotateCode(id,DemoSession.requireIdentity(r)));}
    @GetMapping("/api/teams/{id}/datasets")
    public ResponseEntity<?> datasets(@PathVariable String id,HttpServletRequest r){return ok(datasets.teamDatasets(id,DemoSession.requireIdentity(r)));}
    @PostMapping("/api/teams/{id}/datasets")
    public ResponseEntity<?> createDataset(@PathVariable String id,@RequestBody NameRequest b,HttpServletRequest r){return ok(datasets.createTeamDataset(id,b.name(),DemoSession.requireIdentity(r)));}
    @DeleteMapping("/api/teams/{id}/datasets/{datasetId}")
    public ResponseEntity<?> deleteDataset(@PathVariable String id,@PathVariable String datasetId,HttpServletRequest r){datasets.deleteTeamDataset(id,datasetId,DemoSession.requireIdentity(r));return success();}
    private static ResponseEntity<?> success(){return ok(Map.of("success",true));}
    private static <T> ResponseEntity<T> ok(T value){return ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(value);}
}
