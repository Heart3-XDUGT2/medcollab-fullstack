package com.example.demo;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Component;
import org.springframework.web.multipart.MultipartFile;

/** Upload transport limit, separate from the CT/SEG codec's processing limit. */
@Component
public final class ImportLimits {
    public static final long DEFAULT_MAX_FILE_BYTES = 1_073_741_824L;
    private final long maxFileBytes;

    public ImportLimits(@Value("${app.import.max-file-bytes:1073741824}") long maxFileBytes) {
        if (maxFileBytes <= 0) throw new IllegalArgumentException("app.import.max-file-bytes must be positive");
        this.maxFileBytes = maxFileBytes;
    }

    public long maxFileBytes() { return maxFileBytes; }

    public void validate(MultipartFile file) {
        if (file == null || file.isEmpty() || file.getSize() <= 0)
            throw new ApiException(HttpStatus.BAD_REQUEST, "请选择非空的 DICOM 文件");
        if (file.getSize() > maxFileBytes) throw tooLarge();
        String name=file.getOriginalFilename();
        if(name!=null && name.toLowerCase(java.util.Locale.ROOT).matches(".*\\.nii(?:\\.gz)?$"))
            throw new ApiException(HttpStatus.UNSUPPORTED_MEDIA_TYPE,"暂不支持 NIfTI（.nii/.nii.gz）导入，当前仅支持 DICOM 文件或文件夹");
    }

    public ApiException tooLarge() {
        return new ApiException(HttpStatus.PAYLOAD_TOO_LARGE,
                "单个文件超过当前服务上限（" + maxFileBytes + " 字节）");
    }
}
