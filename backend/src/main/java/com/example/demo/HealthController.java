package com.example.demo;

import java.time.Instant;
import java.util.Map;

import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
public class HealthController {

	@GetMapping("/api/health")
	public Map<String, String> health() {
		return Map.of(
				"workspaceApi", "dicomweb-labelmap-v1",
				"status", "UP",
				"message", "Java 服务器运行正常",
				"application", "medical-annotation-demo",
				"javaVersion", Runtime.version().toString(),
				"osName", System.getProperty("os.name"),
				"osArch", System.getProperty("os.arch"),
				"time", Instant.now().toString());
	}

}
