
var saveFile = () => {
  let data = JSON.stringify(csv);
  data = data.replaceAll('"', '')
  data = data.replaceAll('\\n', '\r\n' )

  const blob = new Blob([data], {type: 'text/csv'});
  const e = document.createEvent('MouseEvents');
  const a = document.createElement('a');
  a.download = 'em-lookups.csv';
  a.href = window.URL.createObjectURL(blob);
  a.dataset.downloadurl = ['text/json', a.download, a.href].join(':');
  e.initEvent('click', true, false);
  a.dispatchEvent(e);
}
