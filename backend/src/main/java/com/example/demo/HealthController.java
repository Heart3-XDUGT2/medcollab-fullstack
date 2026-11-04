package com.example.demo;

import java.time.Instant;
import java.util.Map;

import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
public class HealthController {

	@GetMapping("/api/health")
	public Map<String, String> health() {
		return Map.ofEntries(
				Map.entry("homeActivityApi", "v1"),
				Map.entry("annotationStatsApi", "v1"),
				Map.entry("teamApi", "team-library-v1"),
				Map.entry("sharingPolicy", "personal-irrevocable-v1"),
				Map.entry("workspaceApi", "dicomweb-labelmap-v1"),
				Map.entry("segmentationStorage", "latest-only-v1"),
				Map.entry("status", "UP"),
				Map.entry("message", "Java 服务器运行正常"),
				Map.entry("application", "medical-annotation-demo"),
				Map.entry("javaVersion", Runtime.version().toString()),
				Map.entry("osName", System.getProperty("os.name")),
				Map.entry("osArch", System.getProperty("os.arch")),
				Map.entry("time", Instant.now().toString()));
	}

}
