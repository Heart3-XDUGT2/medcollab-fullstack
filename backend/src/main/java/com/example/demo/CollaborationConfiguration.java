package com.example.demo;

import java.util.Map;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.http.HttpStatus;
import org.springframework.http.server.*;
import org.springframework.scheduling.annotation.EnableScheduling;
import org.springframework.scheduling.concurrent.ThreadPoolTaskScheduler;
import org.springframework.web.socket.WebSocketHandler;
import org.springframework.web.socket.config.annotation.*;
import org.springframework.web.socket.server.HandshakeInterceptor;
import org.springframework.web.util.UriComponentsBuilder;

@Configuration
@EnableWebSocket
@EnableScheduling
public class CollaborationConfiguration implements WebSocketConfigurer {
    private final CollaborationSocket socket;
    private final CollaborationService service;
    private final String origin;
    public CollaborationConfiguration(CollaborationSocket socket,CollaborationService service,@Value("${app.base-url}") String origin) {
        this.socket=socket;this.service=service;this.origin=origin;
    }
    @Bean ThreadPoolTaskScheduler taskScheduler() {
        var scheduler=new ThreadPoolTaskScheduler();scheduler.setPoolSize(2);scheduler.setThreadNamePrefix("collaboration-");return scheduler;
    }
    @Override public void registerWebSocketHandlers(WebSocketHandlerRegistry registry) {
        registry.addHandler(socket,"/ws/medcollab").setAllowedOrigins(origin).addInterceptors(new HandshakeInterceptor() {
            @Override public boolean beforeHandshake(ServerHttpRequest request,ServerHttpResponse response,WebSocketHandler handler,Map<String,Object> attributes) {
                try {
                    if(!(request instanceof ServletServerHttpRequest servlet)) return false;
                    var identity=DemoSession.requireIdentity(servlet.getServletRequest());
                    var params=UriComponentsBuilder.fromUri(request.getURI()).build().getQueryParams();
                    String dataset=params.getFirst("datasetId"),series=params.getFirst("seriesId");
                    if(dataset==null||series==null||dataset.length()>100||series.length()>100) {response.setStatusCode(HttpStatus.BAD_REQUEST);return false;}
                    service.authorize(dataset,series,identity);
                    var session=servlet.getServletRequest().getSession(false);
                    if(session==null) {response.setStatusCode(HttpStatus.UNAUTHORIZED);return false;}
                    attributes.put("identity",identity);attributes.put("httpSession",session);attributes.put("datasetId",dataset);attributes.put("seriesId",series);return true;
                } catch(ApiException e) {response.setStatusCode(e.status());return false;}
            }
            @Override public void afterHandshake(ServerHttpRequest request,ServerHttpResponse response,WebSocketHandler handler,Exception exception) { }
        });
    }
}
