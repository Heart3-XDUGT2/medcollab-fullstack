package com.example.demo;

import static org.assertj.core.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;
import java.net.URI;
import java.net.http.*;
import java.time.Instant;
import java.util.*;
import java.util.concurrent.*;
import jakarta.servlet.*;
import jakarta.servlet.http.*;
import org.junit.jupiter.api.*;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.boot.web.servlet.FilterRegistrationBean;
import org.springframework.context.annotation.Bean;
import org.springframework.core.Ordered;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.oauth2.core.oidc.OidcIdToken;
import org.springframework.security.oauth2.core.oidc.user.DefaultOidcUser;
import org.springframework.security.web.context.HttpSessionSecurityContextRepository;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

/** Real HTTP session + WebSocket handshakes and broadcasts; all image data is synthetic. */
@SpringBootTest(webEnvironment=SpringBootTest.WebEnvironment.RANDOM_PORT,properties={"keycloak.client-secret=test",
        "spring.datasource.url=jdbc:h2:mem:collaboration-transport;DB_CLOSE_DELAY=-1", "app.datasets.seed-enabled=false",
        "app.collaboration.scan-ms=3600000"})
class CollaborationTransportTests {
    static final String ISSUER="http://127.0.0.1:8081/realms/medical-demo",ORIGIN="http://127.0.0.1:8080";
    static final String SERIES="aaaaaaaa-aaaaaaaa-aaaaaaaa-aaaaaaaa-aaaaaaaa",INSTANCE="11111111-11111111-11111111-11111111";
    static final DemoSession.Identity ALICE=new DemoSession.Identity(ISSUER,"alice-sub","alice"),BOB=new DemoSession.Identity(ISSUER,"bob-sub","bob");
    static final JsonMapper JSON=JsonMapper.builder().build();
    @LocalServerPort int port;
    @Autowired DatasetService datasets;
    @Autowired TeamService teams;
    @Autowired JdbcTemplate db;
    @Autowired CollaborationService collaboration;
    @MockitoBean DicomSegCodec codec;
    @MockitoBean OrthancService orthanc;
    @MockitoBean KeycloakDirectoryService directory;
    String dataset;
    final HttpClient http=HttpClient.newHttpClient();
    final List<Peer> peers=new ArrayList<>();
    @TestConfiguration static class TestLogin {
        @Bean FilterRegistrationBean<Filter> testOnlyLoginFilter() {
            Filter filter=(request,response,chain)->{
                var req=(HttpServletRequest)request;
                if(!req.getRequestURI().equals("/__test/login")) {chain.doFilter(request,response);return;}
                String name="bob".equals(req.getParameter("user"))?"bob":"alice";
                var token=new OidcIdToken("synthetic-test",Instant.now(),Instant.now().plusSeconds(600),
                        Map.of("iss",ISSUER,"sub",name+"-sub","preferred_username",name));
                var principal=new DefaultOidcUser(List.of(new SimpleGrantedAuthority("ROLE_USER")),token);
                var context=SecurityContextHolder.createEmptyContext();
                context.setAuthentication(new UsernamePasswordAuthenticationToken(principal,"",principal.getAuthorities()));
                req.getSession(true).setAttribute(HttpSessionSecurityContextRepository.SPRING_SECURITY_CONTEXT_KEY,context);
                ((HttpServletResponse)response).setStatus(200);
            };
            var registration=new FilterRegistrationBean<>(filter);registration.setOrder(Ordered.HIGHEST_PRECEDENCE);return registration;
        }
    }
    static class Inbox implements WebSocket.Listener {
        final BlockingQueue<JsonNode> messages=new LinkedBlockingQueue<>();
        final StringBuilder parts=new StringBuilder();
        @Override public void onOpen(WebSocket socket) {socket.request(1);}
        @Override public CompletionStage<?> onText(WebSocket socket,CharSequence data,boolean last) {
            parts.append(data);if(last) {messages.add(JSON.readTree(parts.toString()));parts.setLength(0);}socket.request(1);return null;
        }
        JsonNode next(String type) throws Exception {
            long until=System.nanoTime()+TimeUnit.SECONDS.toNanos(5);
            while(System.nanoTime()<until) {
                var message=messages.poll(100,TimeUnit.MILLISECONDS);
                if(message!=null&&type.equals(message.path("type").asText())) return message.path("payload");
            }
            throw new AssertionError("No message: "+type);
        }
    }
    record Peer(WebSocket socket,Inbox inbox) { }
    @BeforeEach void setup() {
        dataset=datasets.create("Synthetic CT",ALICE).id();db.update("INSERT INTO dataset_instances VALUES (?,?,?)",dataset,INSTANCE,"1");
        when(codec.sources(anyList())).thenReturn(List.of(new DicomSegCodec.SourceImage(INSTANCE,"1",SERIES,"CT",2,2,"1.2.3")));
        when(directory.requireUser(BOB.subject())).thenReturn(new KeycloakDirectoryService.DirectoryUser(BOB.subject(),BOB.username()));
    }
    @AfterEach void close() {peers.forEach(peer->peer.socket.abort());}
    String cookie(String name) throws Exception {
        var response=http.send(HttpRequest.newBuilder(URI.create("http://127.0.0.1:"+port+"/__test/login?user="+name)).GET().build(),HttpResponse.BodyHandlers.discarding());
        return response.headers().firstValue("set-cookie").orElseThrow().split(";",2)[0];
    }
    Peer join(String cookie,String datasetId,String clientId) throws Exception {
        var inbox=new Inbox();var socket=http.newWebSocketBuilder().header("Cookie",cookie).header("Origin",ORIGIN)
                .buildAsync(URI.create("ws://127.0.0.1:"+port+"/ws/medcollab?datasetId="+datasetId+"&seriesId="+SERIES),inbox).get(5,TimeUnit.SECONDS);
        var peer=new Peer(socket,inbox);peers.add(peer);
        socket.sendText(JSON.writeValueAsString(Map.of("v",1,"type","join","payload",Map.of("clientId",clientId,"protocolVersion",2))),true).join();
        assertThat(inbox.next("room-state").path("protocolVersion").asInt()).isEqualTo(2);return peer;
    }
    @Test void sessionAuthenticatedClientsReceiveOnlyTheirRoomsCommittedPixels() throws Exception {
        enableTeamCoediting();
        String aliceCookie=cookie("alice"),bobCookie=cookie("bob");
        var alice=join(aliceCookie,dataset,"client-alice-001");var bob=join(bobCookie,dataset,"client-bob-001");
        String otherDataset=datasets.create("Separate dataset",ALICE).id();db.update("INSERT INTO dataset_instances VALUES (?,?,?)",otherDataset,INSTANCE,"1");
        var isolated=join(aliceCookie,otherDataset,"client-other-001");
        var lease=collaboration.lease(dataset,SERIES,new CollaborationService.LeaseRequest("client-alice-001",null,"acquire"),ALICE);
        var session=http.send(HttpRequest.newBuilder(URI.create("http://127.0.0.1:"+port+"/api/session")).header("Cookie",aliceCookie).GET().build(),HttpResponse.BodyHandlers.ofString());
        var csrf=JSON.readTree(session.body());
        var operation=new CollaborationService.Operation(UUID.randomUUID().toString(),0,
                List.of(new DicomSegCodec.Segment(1,"心脏",List.of(255,80,80))),List.of(new DicomSegCodec.Mask(INSTANCE,List.of(0,2,1))));
        var body=new CollaborationService.Batch("client-alice-001",lease.leaseId(),List.of(operation));
        var receipt=http.send(HttpRequest.newBuilder(URI.create("http://127.0.0.1:"+port+"/api/datasets/"+dataset+"/segmentations/"+SERIES+"/collaboration/ops/batch"))
                .header("Cookie",aliceCookie).header("Content-Type","application/json").header(csrf.path("csrfHeaderName").asText(),csrf.path("csrfToken").asText())
                .POST(HttpRequest.BodyPublishers.ofString(JSON.writeValueAsString(body))).build(),HttpResponse.BodyHandlers.ofString());
        assertThat(receipt.statusCode()).isEqualTo(200);
        assertThat(alice.inbox.next("mask-committed").path("seq").asLong()).isEqualTo(1);
        assertThat(bob.inbox.next("mask-committed").path("operation").path("masks").get(0).path("runs").toString()).isEqualTo("[0,2,1]");
        assertThat(isolated.inbox.messages.stream().noneMatch(m->"mask-committed".equals(m.path("type").asText()))).isTrue();
        // A fresh connection reads the durable state even though it missed the live broadcast.
        var rejoined=join(bobCookie,dataset,"client-bob-fresh");
        assertThat(collaboration.state(dataset,SERIES,"client-bob-fresh",BOB).seq()).isEqualTo(1);
    }
    @Test void handshakeRejectsUnsharedUsersAndCrossOriginConnections() throws Exception {
        var denied=http.newWebSocketBuilder().header("Cookie",cookie("bob")).header("Origin",ORIGIN)
                .buildAsync(URI.create("ws://127.0.0.1:"+port+"/ws/medcollab?datasetId="+dataset+"&seriesId="+SERIES),new Inbox());
        assertThatThrownBy(()->denied.get(5,TimeUnit.SECONDS)).isInstanceOf(ExecutionException.class);
        var crossOrigin=http.newWebSocketBuilder().header("Cookie",cookie("alice")).header("Origin","https://untrusted.example")
                .buildAsync(URI.create("ws://127.0.0.1:"+port+"/ws/medcollab?datasetId="+dataset+"&seriesId="+SERIES),new Inbox());
        assertThatThrownBy(()->crossOrigin.get(5,TimeUnit.SECONDS)).isInstanceOf(ExecutionException.class);
    }
    // Coediting now belongs to a team; personal forwards have independent IDs.
    private void enableTeamCoediting() {
        if(db.queryForObject("SELECT COUNT(*) FROM dataset_teams WHERE dataset_id=?",Integer.class,dataset)>0) return;
        var team=teams.create("Coediting fixture",ALICE).team().id();
        teams.addMember(team,BOB.subject(),ALICE);
        db.update("INSERT INTO dataset_teams VALUES (?,?)",dataset,team);
    }
}
