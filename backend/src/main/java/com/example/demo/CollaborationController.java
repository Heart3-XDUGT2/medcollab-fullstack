package com.example.demo;

import java.util.List;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/datasets/{datasetId}/segmentations/{seriesId}/collaboration")
public class CollaborationController {
    private final CollaborationService service;
    private final CollaborationSocket socket;
    public CollaborationController(CollaborationService service,CollaborationSocket socket) {this.service=service;this.socket=socket;}

    @GetMapping("/state")
    public CollaborationService.State state(@PathVariable String datasetId,@PathVariable String seriesId,
            @RequestParam String clientId,HttpServletRequest request) {
        return service.state(datasetId,seriesId,clientId,DemoSession.requireIdentity(request));
    }
    @GetMapping("/ops")
    public CollaborationService.Page operations(@PathVariable String datasetId,@PathVariable String seriesId,
            @RequestParam String clientId,@RequestParam(defaultValue="0") long after,HttpServletRequest request) {
        return service.operations(datasetId,seriesId,clientId,after,DemoSession.requireIdentity(request));
    }
    @PostMapping("/ops/batch")
    public List<CollaborationService.Committed> commit(@PathVariable String datasetId,@PathVariable String seriesId,
            @RequestBody CollaborationService.Batch batch,HttpServletRequest request) {
        var result=service.commit(datasetId,seriesId,batch,consistentIdentity(request));
        socket.committed(datasetId,seriesId,result);
        return result;
    }
    @PostMapping("/lease")
    public CollaborationService.Lease lease(@PathVariable String datasetId,@PathVariable String seriesId,
            @RequestBody CollaborationService.LeaseRequest lease,HttpServletRequest request) {
        var result=service.lease(datasetId,seriesId,lease,consistentIdentity(request));
        socket.lockChanged(datasetId,seriesId);
        return result;
    }
    @PostMapping("/slice-lease")
    public List<CollaborationService.SliceLease> sliceLease(@PathVariable String datasetId,@PathVariable String seriesId,
            @RequestBody CollaborationService.SliceRequest lease,HttpServletRequest request) {
        var result=service.sliceLease(datasetId,seriesId,lease,consistentIdentity(request));
        socket.lockChanged(datasetId,seriesId);
        return result;
    }
    @PostMapping("/archive")
    public java.util.Map<String,Boolean> archive(@PathVariable String datasetId,@PathVariable String seriesId,HttpServletRequest request) {
        service.authorize(datasetId,seriesId,consistentIdentity(request));
        socket.archive(datasetId,seriesId);
        return java.util.Map.of("queued",true);
    }
    private static DemoSession.Identity consistentIdentity(HttpServletRequest request) {
        var user=DemoSession.requireIdentity(request);
        String issuer=request.getHeader("X-Medcollab-Issuer"),subject=request.getHeader("X-Medcollab-Subject");
        if((issuer!=null||subject!=null)&&(!user.issuer().equals(issuer)||!user.subject().equals(subject)))
            throw new ApiException(org.springframework.http.HttpStatus.CONFLICT,"账户已切换，请重新打开工作台；原账户的草稿保留在本机");
        return user;
    }
}
