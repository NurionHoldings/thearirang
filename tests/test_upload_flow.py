import base64,http.cookiejar,json,threading,unittest,urllib.request,urllib.error
from test_tracker import server
class UploadFlowTests(unittest.TestCase):
 @classmethod
 def setUpClass(cls):
  import os
  os.environ['ARIRANG_ADMIN_PASSWORD']='test-only-password-2026'
  cls.srv=server.ThreadingHTTPServer(('127.0.0.1',0),server.Handler)
  threading.Thread(target=cls.srv.serve_forever,daemon=True).start()
  cls.url='http://127.0.0.1:'+str(cls.srv.server_port)
 @classmethod
 def tearDownClass(cls):cls.srv.shutdown();cls.srv.server_close()
 def req(self,path,data=None,method=None,csrf=''):
  return json.load(self.op.open(urllib.request.Request(self.url+path,data=json.dumps(data).encode() if data is not None else None,method=method,headers={'Content-Type':'application/json','X-CSRF-Token':csrf})))
 def test_before_quote_and_edit_keep_evidence(self):
  self.op=urllib.request.build_opener(urllib.request.ProxyHandler({}),urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))
  csrf=self.req('/api/login',{'password':'test-only-password-2026'})['csrf']
  p=self.req('/api/project')
  p=self.req('/api/photo/1',{'image':'data:image/png;base64,'+base64.b64encode(b'\x89PNG\r\n\x1a\nexample').decode(),'date':'2026-10-06','note':'입구','viewpoint':'입구 정면','kind':'before','version':p['version']},'POST',csrf)
  self.assertEqual(p['zones']['1']['records'][-1]['kind'],'before')
  p=self.req('/api/quote/1',{'content':'data:application/pdf;base64,'+base64.b64encode(b'%PDF-1.4\nexample').decode(),'name':'견적.pdf','version':p['version']},'POST',csrf)
  v=p['zones']['1'];v['scope']='LED 교체';v['version']=p['version'];p=self.req('/api/zone/1',v,'PUT',csrf)
  self.assertEqual(p['zones']['1']['scope'],'LED 교체');self.assertEqual(len(p['zones']['1']['quotes']),1);self.assertEqual(p['zones']['1']['records'][-1]['viewpoint'],'입구 정면')
  with self.assertRaises(urllib.error.HTTPError) as e:self.req('/api/zone/1',v,'PUT','bad-token')
  self.assertEqual(e.exception.code,403)
