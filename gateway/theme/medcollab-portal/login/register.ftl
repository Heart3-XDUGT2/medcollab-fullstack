<#import "template.ftl" as layout>
<#import "user-profile-commons.ftl" as userProfileCommons>
<#import "icons.ftl" as icons>
<@layout.registrationLayout displayMessage=true; section>
<#if section = "header">注册账号
<#elseif section = "form">
  <form id="kc-register-form" action="${url.registrationAction}" method="post" data-cy="register-form" data-portal-register>
    <@userProfileCommons.userProfileFormFields; callback, attribute>
      <#if callback = "afterField" && passwordRequired?? && (attribute.name == 'username' || (attribute.name == 'email' && realm.registrationEmailAsUsername))>
        <#list ['password', 'password-confirm'] as field>
        <div class="medcollab-sign-in__field mc-profile-field">
          <div class="medcollab-sign-in__label-row"><label for="${field}"><#if field == 'password'>密码<#else>确认密码</#if></label><span class="required">*</span></div>
          <div class="medcollab-sign-in__password">
            <input id="${field}" class="portal-input medcollab-sign-in__input" name="${field}" type="password" autocomplete="new-password" placeholder="<#if field == 'password'>至少 8 位密码<#else>请再次输入密码</#if>" aria-describedby="input-error-${field}" aria-invalid="${messagesPerField.existsError(field)?c}" />
            <button type="button" class="portal-button medcollab-sign-in__password-toggle" aria-label="显示密码" aria-pressed="false" aria-controls="${field}" data-password-toggle><@icons.eye /></button>
          </div>
          <p id="input-error-${field}" class="medcollab-sign-in__field-error" aria-live="polite"><#if messagesPerField.existsError(field)>${kcSanitize(messagesPerField.get(field))?no_esc}</#if></p>
        </div>
        </#list>
      </#if>
    </@userProfileCommons.userProfileFormFields>
    <button type="submit" class="portal-button medcollab-sign-in__submit" data-cy="register-submit">注册账号</button>
    <p class="medcollab-sign-in__service-error" aria-live="polite"></p>
  </form>
  <div class="medcollab-sign-in__register"><span>已有账号？</span><a class="portal-button medcollab-sign-in__text-action" href="${url.loginUrl}" data-cy="register-login">返回登录</a></div>
</#if>
</@layout.registrationLayout>
