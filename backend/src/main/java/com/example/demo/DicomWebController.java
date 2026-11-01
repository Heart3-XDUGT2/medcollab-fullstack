package com.example.demo;

import java.util.*;
import java.util.concurrent.ConcurrentHashMap;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.http.*;
import org.springframework.web.bind.annotation.*;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;
import tools.jackson.databind.node.ObjectNode;

/** Read-only, exact dataset membership scoped QIDO/WADO-RS. No raw Orthanc proxy or STOW. */
@RestController
public class DicomWebController {
    private final DatasetService datasets;
    private final DicomSegCodec codec;
    private final OrthancService orthanc;
    private final JsonMapper json = JsonMapper.builder().build();
    private final Map<String, JsonNode> metadataCache = new ConcurrentHashMap<>();
    public DicomWebController(DatasetService datasets, DicomSegCodec codec, OrthancService orthanc) {
        this.datasets=datasets; this.codec=codec; this.orthanc=orthanc;
    }
    record Image(String id,String seriesId,String studyUID,String seriesUID,String sopUID,JsonNode metadata) { }
    public record Series(String id,String studyInstanceUID,String seriesInstanceUID,String frameOfReferenceUID,
                         String description,int instanceCount) { }
    public record Launch(String datasetId,List<Series> series) { }

    @GetMapping("/api/datasets/{datasetId}/workspace")
    public ResponseEntity<Launch> launch(@PathVariable String datasetId,HttpServletRequest request) {
        List<Image> images=images(datasetId,request);
        Map<String,Series> series=new LinkedHashMap<>();
        for(Image image:images) series.computeIfAbsent(image.seriesId(), id->new Series(id,image.studyUID(),image.seriesUID(),
                value(image.metadata(),"00200052"), value(image.metadata(),"0008103E"),
                (int)images.stream().filter(i->i.seriesId().equals(id)).count()));
        return ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(new Launch(datasetId,List.copyOf(series.values())));
    }

    @GetMapping({"/api/datasets/{datasetId}/dicomweb/studies",
            "/api/datasets/{datasetId}/dicomweb/studies/{study}/series",
            "/api/datasets/{datasetId}/dicomweb/studies/{study}/series/{series}/instances",
            "/api/datasets/{datasetId}/dicomweb/studies/{study}/metadata",
            "/api/datasets/{datasetId}/dicomweb/studies/{study}/series/{series}/metadata",
            "/api/datasets/{datasetId}/dicomweb/studies/{study}/series/{series}/instances/{sop}/metadata"})
    public ResponseEntity<List<JsonNode>> query(@PathVariable String datasetId,
            @PathVariable(required=false) String study,@PathVariable(required=false) String series,
            @PathVariable(required=false) String sop,HttpServletRequest request) {
        var selected=select(images(datasetId,request),study,series,sop);
        boolean metadata=request.getRequestURI().endsWith("/metadata");
        List<JsonNode> rows;
        if(metadata) {
            String base="/api/datasets/"+datasetId+"/dicomweb";
            rows=selected.stream().map(i->rewrite(i.metadata(),base)).toList();
        } else {
            Map<String,JsonNode> grouped=new LinkedHashMap<>();
            for(Image image:selected) {
                String key=series!=null?image.sopUID():study!=null?image.seriesUID():image.studyUID();
                grouped.computeIfAbsent(key,ignored->summary(image,selected,study==null?0:series==null?1:2));
            }
            rows=new ArrayList<>(grouped.values());
            // Standard exact UID/modality filters used by OHIF. No global Orthanc search.
            Map<String,String> filters=Map.of("StudyInstanceUID","0020000D","SeriesInstanceUID","0020000E",
                    "SOPInstanceUID","00080018","Modality","00080060");
            for(var filter:filters.entrySet()) {
                String expected=request.getParameter(filter.getKey());
                if(expected==null) expected=request.getParameter(filter.getValue());
                if(expected!=null) {
                    Set<String> values=new HashSet<>(Arrays.asList(expected.split(",")));
                    rows=rows.stream().filter(n->values.contains(value(n,filter.getValue()))).toList();
                }
            }
            int offset=bounded(request.getParameter("offset"),0,100_000);
            int limit=bounded(request.getParameter("limit"),10_000,10_000);
            rows=rows.stream().skip(offset).limit(limit).toList();
        }
        return ResponseEntity.ok().cacheControl(CacheControl.noStore())
                .contentType(MediaType.parseMediaType("application/dicom+json")).body(rows);
    }

    @GetMapping({"/api/datasets/{datasetId}/dicomweb/studies/{study}/series/{series}/instances/{sop}",
            "/api/datasets/{datasetId}/dicomweb/studies/{study}/series/{series}/instances/{sop}/frames/{frames}",
            "/api/datasets/{datasetId}/dicomweb/studies/{study}/series/{series}/instances/{sop}/bulk/{*bulk}"})
    public ResponseEntity<byte[]> pixels(@PathVariable String datasetId,@PathVariable String study,@PathVariable String series,
            @PathVariable String sop,@PathVariable(required=false) String frames,@PathVariable(required=false) String bulk,
            HttpServletRequest request) {
        Image image=select(images(datasetId,request),study,series,sop).getFirst();
        String path="/studies/"+image.studyUID()+"/series/"+image.seriesUID()+"/instances/"+image.sopUID();
        if(frames!=null) {
            // These sources are ordinary single-frame CTs. Do not forward arbitrary frame paths.
            if(!frames.equals("1")) throw missing();
            path+="/frames/1";
        } else if(bulk!=null) {
            String tail=bulk.replaceFirst("^/","");
            if(!tail.matches("[0-9A-Fa-f]{8}(?:/[0-9]+/[0-9A-Fa-f]{8})*")) throw missing();
            path+="/bulk/"+tail;
        }
        var result=orthanc.dicomWeb(path,false);
        return ResponseEntity.ok().cacheControl(CacheControl.noStore()).header("X-Content-Type-Options","nosniff")
                .contentType(MediaType.parseMediaType(result.contentType())).body(result.body());
    }

    private List<Image> images(String datasetId,HttpServletRequest request) {
        var user=DemoSession.requireIdentity(request);
        var sources=codec.sources(datasets.instances(datasetId,user).items());
        List<Image> result=new ArrayList<>();
        // Fetch each series' metadata once; retain only the explicitly authorized SOPs in the response.
        for(var source:sources) {
            JsonNode metadata=metadataCache.get(source.id());
            if(metadata==null) {
                JsonNode tags=orthanc.simplifiedTags(source.id());
                String study=uid(tags.path("StudyInstanceUID").asText()), series=uid(tags.path("SeriesInstanceUID").asText());
                try {
                    JsonNode nodes=json.readTree(orthanc.dicomWeb("/studies/"+study+"/series/"+series+"/metadata",true).body());
                    if(!nodes.isArray()) throw missing();
                    Map<String,String> ids=new HashMap<>();
                    for(var s:sources) if(s.seriesId().equals(source.seriesId())) ids.put(s.sopInstanceUid(),s.id());
                    if(metadataCache.size()>8192) metadataCache.clear();
                    for(JsonNode node:nodes) {
                        String id=ids.get(value(node,"00080018"));
                        if(id!=null && study.equals(value(node,"0020000D")) && series.equals(value(node,"0020000E")))
                            metadataCache.put(id,node);
                    }
                    metadata=metadataCache.get(source.id());
                    if(metadata==null) throw missing();
                } catch (ApiException e) { throw e; }
                catch (Exception e) { throw new ApiException(HttpStatus.BAD_GATEWAY,"DICOMweb 元数据不可用"); }
            }
            result.add(new Image(source.id(),source.seriesId(),uid(value(metadata,"0020000D")),
                    uid(value(metadata,"0020000E")),uid(value(metadata,"00080018")),metadata));
        }
        return result;
    }
    private List<Image> select(List<Image> images,String study,String series,String sop) {
        if(study!=null) uid(study); if(series!=null) uid(series); if(sop!=null) uid(sop);
        var result=images.stream().filter(i->(study==null||study.equals(i.studyUID())) &&
                (series==null||series.equals(i.seriesUID())) && (sop==null||sop.equals(i.sopUID()))).toList();
        if(result.isEmpty()&&(study!=null||series!=null||sop!=null)) throw missing();
        return result;
    }
    private JsonNode rewrite(JsonNode original,String base) {
        JsonNode node=original.deepCopy(); rewriteNode(node,base); return node;
    }
    private void rewriteNode(JsonNode node,String base) {
        if(node.isObject()) {
            ObjectNode object=(ObjectNode)node;
            if(object.has("BulkDataURI")) {
                String uri=object.path("BulkDataURI").asText();
                int at=uri.indexOf("/studies/");
                if(at>=0 && uri.substring(at).matches("/studies/[0-9.]+/series/[0-9.]+/instances/[0-9.]+/(?:bulk/[0-9A-Fa-f/]+|frames/[0-9,]+)"))
                    object.put("BulkDataURI",base+uri.substring(at));
                else object.remove("BulkDataURI");
            }
            for(JsonNode child:node) rewriteNode(child,base);
        } else if(node.isArray()) for(JsonNode child:node) rewriteNode(child,base);
    }
    private JsonNode summary(Image image,List<Image> selected,int level) {
        ObjectNode result=json.createObjectNode();
        for(String tag:List.of("00080005","00080016","00080018","00080020","00080030","00080050","00080060",
                "00080061","00080090","00081030","0008103E","00100010","00100020","00100030","00100040",
                "0020000D","0020000E","00200010","00200011","00200013","00280010","00280011"))
            if(image.metadata().has(tag)) result.set(tag,image.metadata().get(tag));
        if(level==0) {
            result.set("00201206",number(selected.stream().filter(i->i.studyUID().equals(image.studyUID())).map(Image::seriesUID).distinct().count()));
            result.set("00201208",number(selected.stream().filter(i->i.studyUID().equals(image.studyUID())).count()));
            ObjectNode modalities=json.createObjectNode().put("vr","CS");
            modalities.putArray("Value").add("CT"); result.set("00080061",modalities);
        }
        if(level==1) result.set("00201209",number(selected.stream().filter(i->i.seriesUID().equals(image.seriesUID())).count()));
        return result;
    }
    private ObjectNode number(long value) { ObjectNode n=json.createObjectNode().put("vr","IS"); n.putArray("Value").add(value);return n; }
    private static String value(JsonNode node,String tag) { return node.path(tag).path("Value").path(0).asText(""); }
    private static String uid(String value) { if(value==null||value.length()>64||!value.matches("[0-9]+(?:\\.[0-9]+)+")) throw missing();return value; }
    private static int bounded(String text,int fallback,int max) { try { int n=text==null?fallback:Integer.parseInt(text);if(n<0||n>max)throw new NumberFormatException();return n; } catch(NumberFormatException e){throw new ApiException(HttpStatus.BAD_REQUEST,"分页参数超出范围");} }
    private static ApiException missing() { return new ApiException(HttpStatus.NOT_FOUND,"当前影像集中没有此 DICOM 资源"); }
}
