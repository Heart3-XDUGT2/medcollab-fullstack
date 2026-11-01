package com.example.demo;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.TimeUnit;
import java.util.stream.Stream;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

/** Standard DICOM SEG encoding is isolated from Java's identity and persistence layer. */
@Service
public class DicomSegCodec {
    public record SourceImage(String id, String instanceNumber, String seriesId, String seriesDescription,
                              int rows, int columns, String sopInstanceUid) {}
    public record Mask(String instanceId, List<Integer> runs) {}
    public record Segment(int number,String label,List<Integer> color) { }
    /** runs are start,length,label-number triples; zero is background. */
    public record Labelmap(List<Segment> segments,List<Mask> masks) { }
    private static final Logger log = LoggerFactory.getLogger(DicomSegCodec.class);
    private static final String CT_IMAGE_STORAGE = "1.2.840.10008.5.1.4.1.1.2";
    private static final long MAX_FILE_BYTES = 64L * 1024 * 1024;
    private static final long MAX_JSON_BYTES = 16L * 1024 * 1024;
    private static final long MAX_VOXELS = 134_217_728L;
    private final OrthancService orthanc;
    private final JsonMapper json = JsonMapper.builder().build();
    private final String python;
    private final Path script;
    private final Path work;
    private final Map<String, SourceImage> sourceCache = new LinkedHashMap<>(128, 0.75f, true);

    public DicomSegCodec(OrthancService orthanc,
            @Value("${app.segmentation.python:python3}") String python,
            @Value("${app.segmentation.codec-script:python/seg_codec.py}") String script,
            @Value("${app.segmentation.work-dir:../.runtime/segmentation}") String work) {
        this.orthanc = orthanc;
        this.python = python;
        this.script = Path.of(script).toAbsolutePath().normalize();
        this.work = Path.of(work).toAbsolutePath().normalize();
    }

    /** Caller must supply only instances whose dataset membership was already authorized. */
    public List<SourceImage> sources(List<OrthancService.InstanceItem> items) {
        if (items.size() > 2048) throw badRequest("当前演示绘制器最多支持每个影像集 2048 张切片");
        List<SourceImage> result = new ArrayList<>();
        for (OrthancService.InstanceItem item : items) {
            SourceImage cached;
            synchronized (sourceCache) { cached = sourceCache.get(item.id()); }
            if (cached != null) {
                result.add(cached);
                continue;
            }
            JsonNode tags = orthanc.simplifiedTags(item.id());
            if (!CT_IMAGE_STORAGE.equals(tags.path("SOPClassUID").asText())
                    || tags.path("NumberOfFrames").asInt(1) != 1) continue;
            JsonNode metadata = orthanc.instanceMetadata(item.id());
            int rows = tags.path("Rows").asInt(0);
            int columns = tags.path("Columns").asInt(0);
            String sopUid = tags.path("SOPInstanceUID").asText("");
            String seriesId = metadata.path("ParentSeries").asText("");
            if (rows < 1 || columns < 1 || rows > 4096 || columns > 4096 || sopUid.isBlank() || seriesId.isBlank())
                throw badRequest("CT 缺少有效尺寸或影像编号，暂时无法绘制");
            String description = tags.path("SeriesDescription").asText("CT 序列");
            SourceImage source = new SourceImage(item.id(), item.instanceNumber(), seriesId, description, rows, columns, sopUid);
            synchronized (sourceCache) {
                sourceCache.put(item.id(), source);
                while (sourceCache.size() > 4096) sourceCache.remove(sourceCache.keySet().iterator().next());
            }
            result.add(source);
        }
        return List.copyOf(result);
    }

    public byte[] encode(List<SourceImage> sources, String label, List<Mask> masks) {
        return encodeManifest(sources,Map.of("label",label,"masks",masks));
    }

    public byte[] encodeLabelmap(List<SourceImage> sources,String label,Labelmap data) {
        return encodeManifest(sources,Map.of("label",label,"segments",data.segments(),"masks",data.masks()));
    }

    private byte[] encodeManifest(List<SourceImage> sources,Map<String,Object> values) {
        checkedSources(sources);
        Path temporary = temporaryDirectory();
        try {
            List<Map<String, Object>> manifestSources = new ArrayList<>();
            for (int index = 0; index < sources.size(); index++) {
                SourceImage source = sources.get(index);
                byte[] bytes = orthanc.file(source.id());
                if (bytes.length > MAX_FILE_BYTES) throw badRequest("源 CT 文件超过当前演示的 64 MB 上限");
                Path input = temporary.resolve("source-" + index + ".dcm");
                Files.write(input, bytes);
                manifestSources.add(Map.of("id", source.id(), "path", input.toString(), "sopInstanceUid", source.sopInstanceUid()));
            }
            Path output = temporary.resolve("segmentation.dcm");
            Map<String,Object> manifest=new LinkedHashMap<>(values);
            manifest.put("sources",manifestSources);
            execute("encode", manifest, temporary, output);
            if (Files.size(output) > MAX_FILE_BYTES) throw badRequest("分割文件超过当前演示的 64 MB 上限");
            return Files.readAllBytes(output);
        } catch (ApiException exception) {
            throw exception;
        } catch (IOException exception) {
            throw unavailable();
        } finally { cleanup(temporary); }
    }

    public List<Mask> decode(byte[] seg, List<SourceImage> sources) {
        checkedSources(sources);
        if (seg.length > MAX_FILE_BYTES) throw badRequest("分割文件超过当前演示的 64 MB 上限");
        Path temporary = temporaryDirectory();
        try {
            Path input = temporary.resolve("segmentation.dcm");
            Files.write(input, seg);
            Path output = temporary.resolve("masks.json");
            execute("decode", Map.of("sources", sources, "segPath", input.toString()), temporary, output);
            if (Files.size(output) > MAX_JSON_BYTES) throw badRequest("掩码数据超过当前演示的大小上限");
            JsonNode result = json.readTree(Files.readAllBytes(output));
            if (!result.isArray()) throw unavailable();
            List<Mask> masks = new ArrayList<>();
            for (JsonNode node : result) {
                List<Integer> runs = new ArrayList<>();
                for (JsonNode value : node.path("runs")) runs.add(value.asInt());
                masks.add(new Mask(node.path("instanceId").asText(), List.copyOf(runs)));
            }
            return List.copyOf(masks);
        } catch (ApiException exception) {
            throw exception;
        } catch (Exception exception) {
            throw unavailable();
        } finally { cleanup(temporary); }
    }

    public Labelmap decodeLabelmap(byte[] seg,List<SourceImage> sources) {
        checkedSources(sources);
        if(seg.length>MAX_FILE_BYTES) throw badRequest("分割文件超过 64 MB 上限");
        Path temporary=temporaryDirectory();
        try {
            Path input=temporary.resolve("segmentation.dcm"), output=temporary.resolve("labelmap.json");
            Files.write(input,seg);
            execute("decode-labelmap",Map.of("sources",sources,"segPath",input.toString()),temporary,output);
            if(Files.size(output)>MAX_JSON_BYTES) throw badRequest("掩码数据超过当前演示的大小上限");
            return json.readValue(Files.readAllBytes(output),Labelmap.class);
        } catch(ApiException e) {throw e;}
        catch(Exception e) {throw unavailable();}
        finally {cleanup(temporary);}
    }

    private void execute(String action, Object manifest, Path temporary, Path output) throws IOException {
        if (!Files.isRegularFile(script)) throw unavailable();
        Path input = temporary.resolve("input.json");
        Files.writeString(input, json.writeValueAsString(manifest), StandardCharsets.UTF_8);
        Path stdout = temporary.resolve("stdout.json");
        Path stderr = temporary.resolve("stderr.log");
        Process process = new ProcessBuilder(python, script.toString(), action, input.toString(), output.toString())
                .directory(temporary.toFile()).redirectOutput(stdout.toFile()).redirectError(stderr.toFile()).start();
        final boolean completed;
        try {
            completed = process.waitFor(120, TimeUnit.SECONDS);
        } catch (InterruptedException exception) {
            process.destroyForcibly();
            Thread.currentThread().interrupt();
            throw new ApiException(HttpStatus.SERVICE_UNAVAILABLE, "分割处理已中断，私有草稿仍然保留");
        }
        if (!completed) {
            process.destroyForcibly();
            throw new ApiException(HttpStatus.GATEWAY_TIMEOUT, "DICOM SEG 处理超时，私有草稿仍然保留");
        }
        if (process.exitValue() != 0) {
            String message = "DICOM SEG 处理失败，私有草稿仍然保留";
            if (Files.size(stdout) < 4096) {
                try {
                    String error = json.readTree(Files.readString(stdout)).path("error").asText("");
                    if (!error.isBlank() && error.length() < 200) message = error;
                } catch (Exception ignored) { /* Never return subprocess traces or patient metadata. */ }
            }
            log.warn("DICOM SEG 编解码未完成：操作={}，退出码={}", action, process.exitValue());
            throw new ApiException(process.exitValue() == 2 ? HttpStatus.BAD_REQUEST : HttpStatus.BAD_GATEWAY, message);
        }
        if (!Files.isRegularFile(output)) throw unavailable();
    }

    private Path temporaryDirectory() {
        try {
            Files.createDirectories(work);
            return Files.createTempDirectory(work, "seg-");
        } catch (IOException exception) { throw unavailable(); }
    }

    private void cleanup(Path temporary) {
        // Only our directly-created child directory may be removed.
        if (!temporary.toAbsolutePath().normalize().getParent().equals(work)) return;
        try (Stream<Path> files = Files.walk(temporary)) {
            for (Path file : files.sorted(Comparator.reverseOrder()).toList()) Files.deleteIfExists(file);
        } catch (IOException exception) { log.warn("分割临时文件尚未清理，目录={}", temporary.getFileName()); }
    }

    private static void checkedSources(List<SourceImage> sources) {
        if (sources.isEmpty() || sources.size() > 2048) throw badRequest("请先选择可绘制的 CT 序列");
        SourceImage first = sources.getFirst();
        if ((long) first.rows() * first.columns() * sources.size() > MAX_VOXELS)
            throw badRequest("该序列超过当前演示绘制器的体素上限");
        for (SourceImage source : sources) {
            if (!source.seriesId().equals(first.seriesId()) || source.rows() != first.rows() || source.columns() != first.columns())
                throw badRequest("一个分割必须对应同一 CT 序列和相同切片尺寸");
        }
    }

    private static ApiException badRequest(String message) { return new ApiException(HttpStatus.BAD_REQUEST, message); }
    private static ApiException unavailable() {
        return new ApiException(HttpStatus.SERVICE_UNAVAILABLE, "DICOM SEG 编解码服务暂不可用，私有草稿仍然保留");
    }
}
