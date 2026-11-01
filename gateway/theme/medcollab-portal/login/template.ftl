<#macro registrationLayout bodyClass="" displayInfo=false displayMessage=true displayRequiredFields=false>
<!DOCTYPE html>
<html lang="${(locale.currentLanguageTag)!'zh-CN'}">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title><#nested "header"> | MedCollab</title>
  <link rel="stylesheet" href="${url.resourcesPath}/css/fonts.css" />
  <link rel="stylesheet" href="${url.resourcesPath}/css/styles.css" />
  <link rel="stylesheet" href="${url.resourcesPath}/css/ui.css" />
  <link rel="stylesheet" href="${url.resourcesPath}/css/sign-in.css" />
  <link rel="stylesheet" href="${url.resourcesPath}/css/keycloak-adapter.css" />
  <script src="${url.resourcesPath}/js/portal-auth.js" defer></script>
</head>
<body>
<div class="medcollab-sign-in" data-cy="medcollab-sign-in">
  <header class="medcollab-sign-in__header">
    <a class="medcollab-sign-in__brand" href="${properties.appUrl}/home">MedCollab</a>
    <a class="medcollab-sign-in__back" data-cy="sign-in-home" href="${properties.appUrl}/home">
      <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m15 18-6-6 6-6"/></svg>
      返回首页
    </a>
  </header>
  <main class="medcollab-sign-in__layout">
    <section class="medcollab-sign-in__form-region" aria-labelledby="medcollab-sign-in-title">
      <div class="medcollab-sign-in__intro">
        <h1 id="medcollab-sign-in-title"><#nested "header"></h1>
        <p>登录后访问并管理你的医学影像数据集。</p>
      </div>
      <#if displayMessage && message?has_content>
        <p class="medcollab-sign-in__service-error" role="alert">${kcSanitize(message.summary)?no_esc}</p>
      </#if>
      <#nested "form">
      <#if displayInfo><#nested "info"></#if>
      <#nested "socialProviders">
    </section>
  </main>
</div>
</body>
</html>
</#macro>
