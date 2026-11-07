package com.example.demo;

import java.util.Map;

import jakarta.servlet.http.HttpServletRequest;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.CacheControl;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.http.converter.HttpMessageNotReadableException;
import org.springframework.web.HttpMediaTypeNotSupportedException;
import org.springframework.web.HttpRequestMethodNotSupportedException;
import org.springframework.web.bind.MissingServletRequestParameterException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;
import org.springframework.web.multipart.MaxUploadSizeExceededException;
import org.springframework.web.multipart.MultipartException;
import org.springframework.web.multipart.support.MissingServletRequestPartException;
import org.springframework.web.servlet.resource.NoResourceFoundException;

@RestControllerAdvice
public class ApiErrorHandler {
    private static final Logger log = LoggerFactory.getLogger(ApiErrorHandler.class);

    @ExceptionHandler(ApiException.class)
    public ResponseEntity<Map<String, String>> applicationError(ApiException exception, HttpServletRequest request) {
        log.warn("请求未完成：{} {} -> {}，原因={}", request.getMethod(), request.getRequestURI(),
                exception.status().value(), exception.getMessage());
        return error(exception.status(), exception.getMessage());
    }

    @ExceptionHandler(MaxUploadSizeExceededException.class)
    public ResponseEntity<Map<String, String>> tooLarge() {
        return error(HttpStatus.PAYLOAD_TOO_LARGE, "上传超过当前服务的单文件或整请求大小上限，请拆分后重试");
    }

    @ExceptionHandler({HttpMessageNotReadableException.class, MissingServletRequestParameterException.class,
            MissingServletRequestPartException.class, MultipartException.class})
    public ResponseEntity<Map<String, String>> badRequest(Exception exception) {
        log.warn("请求格式不正确：类型={}", exception.getClass().getSimpleName());
        return error(HttpStatus.BAD_REQUEST, "请求格式不正确，请选择有效的 DICOM 文件或刷新页面后重试");
    }

    @ExceptionHandler(org.springframework.web.method.annotation.MethodArgumentTypeMismatchException.class)
    public ResponseEntity<Map<String, String>> invalidParameter() {
        return error(HttpStatus.BAD_REQUEST,"查询参数格式不正确，请检查 page、size 等参数");
    }

    @ExceptionHandler(HttpMediaTypeNotSupportedException.class)
    public ResponseEntity<Map<String, String>> unsupportedContentType() {
        return error(HttpStatus.UNSUPPORTED_MEDIA_TYPE, "请求内容类型不正确，请通过页面提交");
    }

    @ExceptionHandler(HttpRequestMethodNotSupportedException.class)
    public ResponseEntity<Map<String, String>> unsupportedMethod() {
        return error(HttpStatus.METHOD_NOT_ALLOWED, "此接口不支持该请求方法");
    }

    @ExceptionHandler(NoResourceFoundException.class)
    public ResponseEntity<Map<String, String>> missingResource() {
        return error(HttpStatus.NOT_FOUND, "未找到请求的接口或文件");
    }

    @ExceptionHandler(Exception.class)
    public ResponseEntity<Map<String, String>> unexpected(Exception exception, HttpServletRequest request) {
        log.error("服务器处理失败：{} {}，类型={}", request.getMethod(), request.getRequestURI(),
                exception.getClass().getName());
        return error(HttpStatus.INTERNAL_SERVER_ERROR, "Java 服务器处理请求失败，请查看服务器日志");
    }

    private static ResponseEntity<Map<String, String>> error(HttpStatus status, String message) {
        return ResponseEntity.status(status).cacheControl(CacheControl.noStore()).body(Map.of("error", message));
    }
}
