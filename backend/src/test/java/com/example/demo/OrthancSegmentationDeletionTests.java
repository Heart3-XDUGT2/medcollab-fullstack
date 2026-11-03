package com.example.demo;

import static org.assertj.core.api.Assertions.*;
import com.sun.net.httpserver.HttpServer;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;

class OrthancSegmentationDeletionTests {
    static final String ID = "22222222-22222222-22222222-22222222-22222222";

    @Test void sendsDeleteOnlyAfterCheckingSegTypeAndTreatsAlreadyDeletedAsSuccess() throws Exception {
        for (String type : List.of("1.2.840.10008.5.1.4.1.1.66.4","1.2.840.10008.5.1.4.1.1.66.7")) {
            List<String> methods = new ArrayList<>();
            var server = HttpServer.create(new InetSocketAddress("127.0.0.1",0),0);
            server.createContext("/instances/"+ID, exchange->{
                methods.add(exchange.getRequestMethod());
                if (exchange.getRequestURI().getPath().endsWith("/simplified-tags")) {
                    byte[] body=("{\"SOPClassUID\":\""+type+"\"}").getBytes(StandardCharsets.UTF_8);
                    exchange.sendResponseHeaders(200,body.length);
                    exchange.getResponseBody().write(body);
                } else exchange.sendResponseHeaders(404,-1);
                exchange.close();
            });
            server.start();
            try {
                new OrthancService("http://127.0.0.1:"+server.getAddress().getPort()).deleteSegmentation(ID);
                assertThat(methods).containsExactly("GET","DELETE");
            } finally { server.stop(0); }
        }
    }

    @Test void refusesCtAndRetriesUpstreamFailuresWithoutSilentlyReportingSuccess() throws Exception {
        for (boolean unavailable : List.of(false,true)) {
            List<String> methods=new ArrayList<>();
            var server=HttpServer.create(new InetSocketAddress("127.0.0.1",0),0);
            server.createContext("/instances/"+ID, exchange->{
                methods.add(exchange.getRequestMethod());
                if (unavailable) exchange.sendResponseHeaders(503,-1);
                else {
                    byte[] body="{\"SOPClassUID\":\"1.2.840.10008.5.1.4.1.1.2\"}".getBytes(StandardCharsets.UTF_8);
                    exchange.sendResponseHeaders(200,body.length);
                    exchange.getResponseBody().write(body);
                }
                exchange.close();
            });
            server.start();
            try {
                var orthanc=new OrthancService("http://127.0.0.1:"+server.getAddress().getPort());
                assertThatThrownBy(()->orthanc.deleteSegmentation(ID)).isInstanceOfSatisfying(ApiException.class,
                        e->assertThat(e.status()).isEqualTo(unavailable?HttpStatus.BAD_GATEWAY:HttpStatus.CONFLICT));
                assertThat(methods).containsExactly("GET");
            } finally { server.stop(0); }
        }
    }

    @Test void missingMetadataIsAnIdempotentCleanup() throws Exception {
        var server=HttpServer.create(new InetSocketAddress("127.0.0.1",0),0);
        server.createContext("/", exchange->{exchange.sendResponseHeaders(404,-1);exchange.close();});
        server.start();
        try { new OrthancService("http://127.0.0.1:"+server.getAddress().getPort()).deleteSegmentation(ID); }
        finally { server.stop(0); }
    }
}
