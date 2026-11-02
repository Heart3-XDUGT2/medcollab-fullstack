<#import "template.ftl" as layout>
<@layout.registrationLayout displayMessage=true; section>
<#if section = "header">找回密码
<#elseif section = "form">
  <form id="kc-reset-password-form" action="${url.loginAction}" method="post">
    <div class="medcollab-sign-in__field">
      <div class="medcollab-sign-in__label-row"><label for="username"><#if realm.loginWithEmailAllowed>邮箱或账号<#else>账号</#if></label></div>
      <input id="username" class="portal-input medcollab-sign-in__input" name="username" type="text" autocomplete="username" autocapitalize="none" spellcheck="false" value="${(auth.attemptedUsername!'')}" aria-invalid="${messagesPerField.existsError('username')?c}" aria-describedby="input-error-username" />
      <p id="input-error-username" class="medcollab-sign-in__field-error"><#if messagesPerField.existsError('username')>${kcSanitize(messagesPerField.get('username'))?no_esc}</#if></p>
    </div>
    <button type="submit" class="portal-button medcollab-sign-in__submit">发送重置邮件</button>
  </form>
  <div class="medcollab-sign-in__register"><a class="medcollab-sign-in__text-action" href="${url.loginUrl}">返回登录</a></div>
</#if>
</@layout.registrationLayout>
