<#import "template.ftl" as layout>
<#import "icons.ftl" as icons>
<@layout.registrationLayout displayMessage=false; section>
<#if section = "header">登录
<#elseif section = "form">
  <form id="kc-form-login" action="${url.loginAction}" method="post" novalidate data-cy="sign-in-form" data-portal-login>
    <#if !usernameHidden??>
    <div class="medcollab-sign-in__field">
      <div class="medcollab-sign-in__label-row"><label for="medcollab-identifier">邮箱或账号</label></div>
      <input id="medcollab-identifier" class="portal-input medcollab-sign-in__input" name="username" type="text" autocomplete="username" autocapitalize="none" spellcheck="false" value="${(login.username!'')}" placeholder="请输入邮箱或账号" data-cy="sign-in-identifier" aria-describedby="medcollab-identifier-error" />
      <p id="medcollab-identifier-error" class="medcollab-sign-in__field-error" aria-live="polite" data-cy="sign-in-identifier-error"></p>
    </div>
    </#if>
    <div class="medcollab-sign-in__field">
      <div class="medcollab-sign-in__label-row">
        <label for="medcollab-password">密码</label>
        <#if realm.resetPasswordAllowed>
          <a class="portal-button portal-button--link portal-button--default medcollab-sign-in__text-action" href="${url.loginResetCredentialsUrl}" data-cy="sign-in-forgot">忘记密码？</a>
        <#else>
          <button type="button" class="portal-button portal-button--link portal-button--default medcollab-sign-in__text-action" data-cy="sign-in-forgot" data-help-dialog>忘记密码？</button>
        </#if>
      </div>
      <div class="medcollab-sign-in__password">
        <input id="medcollab-password" class="portal-input medcollab-sign-in__input" name="password" type="password" autocomplete="current-password" placeholder="请输入密码" data-cy="sign-in-password" aria-describedby="medcollab-password-error" />
        <button type="button" class="portal-button portal-button--ghost portal-button--icon medcollab-sign-in__password-toggle" aria-label="显示密码" aria-pressed="false" aria-controls="medcollab-password" title="显示密码" data-cy="sign-in-password-toggle" data-password-toggle><@icons.eye /></button>
      </div>
      <p id="medcollab-password-error" class="medcollab-sign-in__field-error" aria-live="polite" data-cy="sign-in-password-error"></p>
    </div>
    <input type="hidden" name="credentialId" <#if auth.selectedCredential?has_content>value="${auth.selectedCredential}"</#if> />
    <button id="kc-login" name="login" type="submit" class="portal-button portal-button--default portal-button--default medcollab-sign-in__submit" data-cy="sign-in-submit">登录</button>
    <p class="medcollab-sign-in__service-error" role="alert" aria-atomic="true" data-cy="sign-in-service-error"><#if message?has_content>${kcSanitize(message.summary)?no_esc}</#if></p>
  </form>
  <#if realm.registrationAllowed && !registrationDisabled??>
  <div class="medcollab-sign-in__register">
    <span>还没有账号？</span>
    <a class="portal-button portal-button--link portal-button--default medcollab-sign-in__text-action" href="${url.registrationUrl}" data-cy="sign-in-register">注册账号</a>
  </div>
  </#if>
  <div class="portal-dialog-overlay" data-help-overlay hidden></div>
  <div class="portal-dialog medcollab-auth-dialog" role="dialog" aria-modal="true" aria-labelledby="help-title" aria-describedby="help-description" data-cy="sign-in-help-dialog" hidden>
    <div class="portal-dialog-header"><h2 id="help-title">暂时无法找回密码</h2><p id="help-description">当前账号服务尚未配置密码重置邮件，请联系平台管理员。</p></div>
    <button type="button" class="portal-button medcollab-auth-dialog__close" data-help-close>知道了</button>
    <button type="button" class="portal-dialog-close" aria-label="关闭" data-cy="dialog-close-button" data-help-close><svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18M6 6l12 12"/></svg></button>
  </div>
</#if>
</@layout.registrationLayout>
