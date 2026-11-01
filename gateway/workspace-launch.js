/* Portal's existing button enters here. All destinations are deployment-owned paths. */
(async()=>{
  const status=document.getElementById('status');
  const params=new URLSearchParams(location.search), datasetId=params.get('datasetId');
  try {
    if(!datasetId)throw new Error('缺少影像集编号，请从首页打开工作界面');
    const response=await fetch('/api/datasets/'+encodeURIComponent(datasetId)+'/workspace',{credentials:'same-origin',cache:'no-store'});
    const data=await response.json();if(!response.ok)throw new Error(data.error||'无法打开影像');
    if(!data.series.length)throw new Error('此影像集没有可标注的单帧 CT 序列');
    function open(series) {
      const query=new URLSearchParams({datasetId,seriesId:series.id,StudyInstanceUIDs:series.studyInstanceUID,
        SeriesInstanceUIDs:series.seriesInstanceUID,lng:'zh-CN'});
      location.replace('/imaging/medcollab/medcollab?'+query);
    }
    if(data.series.length===1){open(data.series[0]);return;}
    status.textContent='请选择要打开的 CT 序列：';
    for(const series of data.series) {
      const button=document.createElement('button');button.textContent=(series.description||'CT 序列')+'（'+series.instanceCount+' 张）';
      button.onclick=()=>open(series);document.getElementById('series').append(button,document.createElement('br'));
    }
  }catch(error){status.textContent=error.message;}
})();
