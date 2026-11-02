package com.example.demo;

import java.io.IOException;
import java.time.Instant;
import java.util.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicLong;
import jakarta.annotation.PreDestroy;
import jakarta.servlet.http.HttpSession;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.security.core.context.SecurityContext;
import org.springframework.security.oauth2.core.oidc.user.OidcUser;
import org.springframework.security.web.context.HttpSessionSecurityContextRepository;
import org.springframework.stereotype.Component;
import org.springframework.web.socket.*;
import org.springframework.web.socket.handler.ConcurrentWebSocketSessionDecorator;
import org.springframework.web.socket.handler.TextWebSocketHandler;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

/** Single-instance room directory. Authorization is rechecked on messages and fan-out. */
@Component
public class CollaborationSocket extends TextWebSocketHandler {
    private static class Member {
        final WebSocketSession socket;
        final DemoSession.Identity user;
        final HttpSession httpSession;
        final String dataset,series,key;
        final AtomicLong seq=new AtomicLong();
        volatile long lastSeen=System.currentTimeMillis();
        volatile boolean joined;
        volatile String clientId;
        volatile Integer activeSegment;
        volatile String activeLabel;
        volatile Object cursor;
        long window=System.currentTimeMillis();
        int messages;
        CompletableFuture<Void> outgoing=CompletableFuture.completedFuture(null);
        int queued;
        Member(WebSocketSession session) {
            socket=new ConcurrentWebSocketSessionDecorator(session,5_000,512*1024);
            user=(DemoSession.Identity)session.getAttributes().get("identity");
            httpSession=(HttpSession)session.getAttributes().get("httpSession");
            dataset=(String)session.getAttributes().get("datasetId");series=(String)session.getAttributes().get("seriesId");key=dataset+":"+series;
        }
    }
    private final ConcurrentHashMap<String,Member> members=new ConcurrentHashMap<>();
    private final CollaborationService service;
    private final DatasetService datasets;
    private final JsonMapper json=JsonMapper.builder().build();
    private final ExecutorService sends=Executors.newVirtualThreadPerTaskExecutor();
    public CollaborationSocket(CollaborationService service,DatasetService datasets) {this.service=service;this.datasets=datasets;}

    @Override public void afterConnectionEstablished(WebSocketSession session) throws Exception {
        session.setTextMessageSizeLimit(256*1024);session.setBinaryMessageSizeLimit(1024);
        var member=new Member(session);
        synchronized(members) {
            if(members.size()>=2000||members.values().stream().filter(m->m.key.equals(member.key)).count()>=32
                    ||members.values().stream().filter(m->m.user.equals(member.user)).count()>=8) {
                session.close(new CloseStatus(4429,"connection limit"));return;
            }
            members.put(session.getId(),member);
        }
    }
    @Override protected void handleTextMessage(WebSocketSession session,TextMessage message) {
        var member=members.get(session.getId());if(member==null) return;
        try {
            check(member);
            long now=System.currentTimeMillis();
            if(now-member.window>=1000) {member.window=now;member.messages=0;}
            if(++member.messages>60) {close(member,4429,"rate limit");return;}
            JsonNode envelope=json.readTree(message.getPayload());
            if(envelope.path("v").asInt()!=1) throw new IllegalArgumentException("version");
            String type=envelope.path("type").asText();var payload=envelope.path("payload");member.lastSeen=now;
            if("join".equals(type)) {
                String clientId=payload.path("clientId").asText();CollaborationService.checkedId(clientId);member.clientId=clientId;
                // v1 keeps presence. Only v2 explicitly enables the durable collaborative room.
                if(payload.path("protocolVersion").asInt()==2) service.state(member.dataset,member.series,clientId,member.user);
                member.joined=true;presence(member,payload);
                send(member,"room-state",Map.of("protocolVersion",2,"capabilities",List.of("mask-ops","lease","slice-lease","archive"),
                        "self",Map.of("memberId",session.getId(),"subject",member.user.subject()),"members",roster(member.key),"segments",List.of()));
                broadcastPresence(member.key);
            } else if(!member.joined) throw new IllegalArgumentException("join required");
            else if("presence".equals(type)) {presence(member,payload);fanout(member.key,"presence",display(member),null);}
            else if("stroke-preview".equals(type)) {
                if(!service.previewAllowed(member.dataset,member.series,member.clientId,member.user)) return;
                var points=payload.path("points");
                if(!points.isArray()||points.size()>32||message.getPayloadLength()>8192) throw new IllegalArgumentException("preview size");
                for(var point:points) {
                    if(!point.isArray()||point.size()!=3) throw new IllegalArgumentException("world point");
                    for(var value:point) if(!value.isNumber()||!Double.isFinite(value.asDouble())||Math.abs(value.asDouble())>1_000_000) throw new IllegalArgumentException("coordinate");
                }
                fanout(member.key,"stroke-preview",Map.of("subject",member.user.subject(),"username",member.user.username(),"points",points),member.socket.getId());
            }
            else if("ping".equals(type)) send(member,"pong",Map.of());
            else if("leave".equals(type)) close(member,1000,"left");
            else send(member,"error",Map.of("code","UNSUPPORTED_MESSAGE","message","正式修改请使用操作提交接口","fatal",false));
        } catch(ApiException e) {
            if(e.status().value()==401||e.status().value()==403||e.status().value()==404) close(member,e.status().value()==401?4401:4403,"access denied");
            else send(member,"error",Map.of("code","INVALID_OPERATION","message",e.getMessage(),"fatal",false));
        } catch(RuntimeException e) {send(member,"error",Map.of("code","INVALID_MESSAGE","message","协作消息格式无效","fatal",false));}
    }
    private void presence(Member member,JsonNode payload) {
        var segment=payload.path("activeSegment");
        member.activeSegment=segment.isIntegralNumber()&&segment.asInt()>0&&segment.asInt()<=255?segment.asInt():null;
        String label=payload.path("activeLabel").asText("");member.activeLabel=label.length()<=64?label:null;member.cursor=null;
        var world=payload.path("cursor").path("world");
        if(world.isArray()&&world.size()==3) {
            var values=new ArrayList<Double>();
            for(var value:world) {if(!value.isNumber()||!Double.isFinite(value.asDouble())) return;values.add(value.asDouble());}
            member.cursor=Map.of("world",values);
        }
    }
    private void check(Member member) {
        try {
            var context=member.httpSession.getAttribute(HttpSessionSecurityContextRepository.SPRING_SECURITY_CONTEXT_KEY);
            if(!(context instanceof SecurityContext security)||security.getAuthentication()==null
                    ||!(security.getAuthentication().getPrincipal() instanceof OidcUser user)
                    ||!member.user.subject().equals(user.getSubject())||user.getIssuer()==null||!member.user.issuer().equals(user.getIssuer().toString()))
                throw new IllegalStateException();
        } catch(IllegalStateException e) {throw new ApiException(org.springframework.http.HttpStatus.UNAUTHORIZED,"会话已失效");}
        datasets.requireDatasetAccess(member.dataset,member.user,false);
    }
    private Map<String,Object> display(Member member) {
        var data=new LinkedHashMap<String,Object>();
        data.put("memberId",member.socket.getId());data.put("subject",member.user.subject());data.put("username",member.user.username());
        data.put("role","member");data.put("segmentNumber",null);data.put("online",true);
        data.put("activeSegment",member.activeSegment);data.put("activeLabel",member.activeLabel);
        data.put("cursor",member.cursor);data.put("lastSeen",Instant.ofEpochMilli(member.lastSeen).toString());return data;
    }
    private List<Map<String,Object>> roster(String key) {
        var result=new LinkedHashMap<String,Member>();
        members.values().stream().filter(m->m.joined&&m.key.equals(key)).forEach(m->result.merge(m.user.subject(),m,(a,b)->a.lastSeen>b.lastSeen?a:b));
        return result.values().stream().map(this::display).toList();
    }
    private void broadcastPresence(String key) {
        fanout(key,"members-state",Map.of("members",roster(key)),null);
        for(var item:roster(key)) fanout(key,"presence",item,null);
    }
    private void fanout(String key,String type,Object payload,String except) {
        members.values().stream().filter(m->m.joined&&m.key.equals(key)&&!m.socket.getId().equals(except)).forEach(m->send(m,type,payload));
    }
    private void send(Member member,String type,Object payload) {
        synchronized(member) {
            if(member.queued>=256) {close(member,4429,"slow consumer");return;}
            member.queued++;
            member.outgoing=member.outgoing.handle((v,e)->null).thenRunAsync(()->{
                try {
                    check(member);
                    member.socket.sendMessage(new TextMessage(json.writeValueAsString(Map.of("v",1,"type",type,"seq",member.seq.incrementAndGet(),
                            "ts",Instant.now().toString(),"payload",payload))));
                } catch(Exception e) {close(member,4403,"connection unavailable");}
                finally {synchronized(member) {member.queued--;}}
            },sends);
        }
    }
    public void committed(String dataset,String series,List<CollaborationService.Committed> operations) {
        for(var operation:operations) {
            fanout(dataset+":"+series,"mask-committed",operation,null);
            fanout(dataset+":"+series,"activity",Map.of("id",operation.clientOpId(),"subject",operation.subject(),
                    "username",operation.username(),"kind","mask-committed","text","更新了掩码","at",operation.at()),null);
        }
    }
    public void lockChanged(String dataset,String series) {fanout(dataset+":"+series,"lock-state",Map.of("changed",true),null);}
    public void archive(String dataset,String series) {sends.submit(()->service.archive(dataset,series));}
    @Scheduled(fixedDelay=5_000) void sweep() {
        for(var member:members.values()) {
            try {check(member);if(System.currentTimeMillis()-member.lastSeen>30_000) close(member,1001,"heartbeat timeout");}
            catch(RuntimeException e) {close(member,4403,"access revoked");}
        }
    }
    private void close(Member member,int code,String reason) {
        if(members.remove(member.socket.getId(),member)) {
            try {member.socket.close(new CloseStatus(code,reason));} catch(IOException ignored) { }
            if(member.joined) {
                var offline=new LinkedHashMap<>(display(member));offline.put("online",false);
                if(roster(member.key).stream().noneMatch(m->member.user.subject().equals(m.get("subject")))) fanout(member.key,"presence",offline,null);
                broadcastPresence(member.key);
            }
        }
    }
    @Override public void afterConnectionClosed(WebSocketSession session,CloseStatus status) {
        var member=members.get(session.getId());if(member!=null) close(member,1000,"closed");
    }
    @Override public void handleTransportError(WebSocketSession session,Throwable exception) {
        var member=members.get(session.getId());if(member!=null) close(member,1011,"transport error");
    }
    @PreDestroy void stop() {members.values().forEach(m->close(m,1001,"server stopping"));sends.shutdownNow();}
}
