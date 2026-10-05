"""Single-server durable construction tracker. No third-party dependencies."""
import base64, hashlib, hmac, json, os, secrets, sqlite3, time, re
from pathlib import Path
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from http.cookies import SimpleCookie
ROOT=Path(__file__).parent
DATA=Path(os.environ.get('ARIRANG_DATA_DIR',str(ROOT/'data')))
DATA.mkdir(parents=True,exist_ok=True)
(DB:=DATA/'project.sqlite3')
ZONES=['b1','1','2a','2b','3','4','5']
STATUSES=['미등록','예정','진행 중','완료','보류']
SESSIONS={}; ATTEMPTS={}
def connect():
 c=sqlite3.connect(DB,timeout=10);c.execute('PRAGMA journal_mode=WAL');return c
def initial():
 p={'version':0,'zones':{z:{'steps':[{'status':'예정' if z not in ['b1','2b'] else '미등록','start':'','end':'','owner':'','note':''} for _ in range(6)],'checks':[False]*4,'records':[],'contractors':{},'costs':[]} for z in ZONES}}
 p['zones']['1']['steps'][2].update(status='진행 중',note='사용자 확인: 전기공사 진행 중')
 p['zones']['1']['steps'][4].update(status='진행 중',note='사용자 확인: 마트 진열장 공사 진행 중')
 return p
with connect() as c:
 c.execute('CREATE TABLE IF NOT EXISTS project (id INTEGER PRIMARY KEY, content TEXT NOT NULL)')
 c.execute('CREATE TABLE IF NOT EXISTS audit (id INTEGER PRIMARY KEY, created TEXT, zone TEXT, action TEXT)')
 c.execute('INSERT OR IGNORE INTO project VALUES (1,?)',(json.dumps(initial()),))
def read():
 with connect() as c:return json.loads(c.execute('SELECT content FROM project WHERE id=1').fetchone()[0])
def validate_zone(v):
 import math
 trades=['전기공사','내부미장','인테리어','냉난방기 설치','마트설계','기타']
 contractors=v.get('contractors',{})
 if not isinstance(contractors,dict) or any(k not in trades for k in contractors):raise ValueError('업체 형식 오류')
 for c in contractors.values():
  if not isinstance(c,dict):raise ValueError('업체 형식 오류')
  for k,limit in [('name',100),('contact',80),('phone',40)]:
   if not isinstance(c.get(k,''),str) or len(c.get(k,''))>limit:raise ValueError('업체 입력 길이 오류')
 rows=v.get('costs',[])
 if not isinstance(rows,list) or len(rows)>100:raise ValueError('산출 항목 수 오류')
 for r in rows:
  if not isinstance(r,dict) or r.get('trade') not in trades:raise ValueError('공종 오류')
  for k,limit in [('item',150),('unit',20),('note',300)]:
   if not isinstance(r.get(k),str) or len(r[k])>limit:raise ValueError('산출 입력 형식 오류')
  if not r['item'].strip():raise ValueError('품명·규격이 필요합니다.')
  for k,minimum,maximum in [('qty',0.001,1000000),('price',0,100000000000),('vat',0,10)]:
   n=r.get(k)
   if type(n) not in [int,float] or not math.isfinite(n) or not minimum<=n<=maximum:raise ValueError('수량·단가 형식 오류')
  if r['vat'] not in [0,10] or int(r['price'])!=r['price']:raise ValueError('부가세·단가 오류')
  if r['qty']*r['price']>9000000000000:raise ValueError('항목 금액이 허용 범위를 초과했습니다.')

 if not isinstance(v,dict) or not isinstance(v.get('steps'),list) or len(v['steps'])!=6:raise ValueError('단계 형식 오류')
 if not isinstance(v.get('checks'),list) or len(v['checks'])!=4 or any(type(x)!=bool for x in v['checks']):raise ValueError('점검 형식 오류')
 for s in v['steps']:
  if not isinstance(s,dict) or s.get('status') not in STATUSES:raise ValueError('상태 형식 오류')
  for k,limit in [('start',10),('end',10),('owner',80),('note',1000)]:
   if not isinstance(s.get(k),str) or len(s[k])>limit:raise ValueError('입력 형식 오류')
  import datetime
  for k in ['start','end']:
   if s[k]:datetime.date.fromisoformat(s[k])
  if s['start'] and s['end'] and s['end']<s['start']:raise ValueError('종료일은 시작일 이후여야 합니다.')
  if s['status']=='완료' and (not s['owner'].strip() or not s['note'].strip()):raise ValueError('완료 담당자와 근거가 필요합니다.')
 if v['steps'][5]['status']=='완료' and (any(s['status']!='완료' for s in v['steps'][:5]) or not all(v['checks'])):raise ValueError('인계 완료 전 선행 공정과 자체 점검을 확인하세요.')
def update(zone,value,version,action):
 with connect() as c:
  c.execute('BEGIN IMMEDIATE');p=json.loads(c.execute('SELECT content FROM project WHERE id=1').fetchone()[0])
  if version!=p['version']:raise ValueError('다른 관리자가 수정했습니다. 최신 기록을 확인하세요.')
  if action=='zone':value['records']=p['zones'][zone]['records'];p['zones'][zone]=value
  else:p['zones'][zone]['records'].append(value)
  p['version']+=1;c.execute('UPDATE project SET content=? WHERE id=1',(json.dumps(p,ensure_ascii=False),));c.execute('INSERT INTO audit(created,zone,action) VALUES (?,?,?)',(time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime()),zone,action));return p
class Handler(SimpleHTTPRequestHandler):
 def __init__(self,*a,**k):super().__init__(*a,directory=str(ROOT/'public'),**k)
 def reply(self,v,status=200,cookie=None):
  b=json.dumps(v,ensure_ascii=False).encode();self.send_response(status);self.send_header('Content-Type','application/json; charset=utf-8');self.send_header('Cache-Control','no-store');self.send_header('X-Content-Type-Options','nosniff')
  if cookie:self.send_header('Set-Cookie',cookie)
  self.send_header('Content-Length',str(len(b)));self.end_headers();self.wfile.write(b)
 def session(self):
  try:c=SimpleCookie(self.headers.get('Cookie',''));token=c['arirang_session'].value
  except:return None
  s=SESSIONS.get(token);return s if s and s['expires']>time.time() else None
 def body(self):
  n=int(self.headers.get('Content-Length','0'))
  if n>12*1024*1024:raise ValueError('요청 용량 초과')
  return json.loads(self.rfile.read(n))
 def do_GET(self):
  if self.path=='/api/project':return self.reply(read())
  if self.path=='/api/session':
   s=self.session();return self.reply({'admin':bool(s),'csrf':s['csrf'] if s else None})
  if self.path.startswith('/uploads/'):
   name=self.path.removeprefix('/uploads/')
   if not re.fullmatch(r'[0-9a-f]{32}\.(jpg|png|webp)',name):return self.send_error(404)
   p=DATA/'uploads'/name
   if not p.is_file():return self.send_error(404)
   b=p.read_bytes();self.send_response(200);self.send_header('Content-Type',{'jpg':'image/jpeg','png':'image/png','webp':'image/webp'}[p.suffix[1:]]);self.send_header('X-Content-Type-Options','nosniff');self.send_header('Content-Length',str(len(b)));self.end_headers();self.wfile.write(b);return
  if self.path.startswith('/api/'):return self.reply({'error':'경로 없음'},404)
  return super().do_GET()
 def mutate(self):
  try:
   origin=self.headers.get('Origin')
   if origin and origin not in ('http://'+self.headers.get('Host',''),'https://'+self.headers.get('Host','')):return self.reply({'error':'요청 출처 오류'},403)
   if self.path=='/api/login':
    password=os.environ.get('ARIRANG_ADMIN_PASSWORD','')
    if len(password)<12:return self.reply({'error':'서버 관리자 비밀번호(12자 이상)가 아직 설정되지 않았습니다.'},503)
    ip=self.client_address[0];attempt=ATTEMPTS.get(ip,[]);attempt=[t for t in attempt if t>time.time()-600]
    if len(attempt)>=8:return self.reply({'error':'로그인 시도가 많습니다. 10분 뒤 재시도하세요.'},429)
    b=self.body()
    if not hmac.compare_digest(str(b.get('password','')),password):ATTEMPTS[ip]=attempt+[time.time()];return self.reply({'error':'비밀번호를 확인하세요.'},401)
    token=secrets.token_urlsafe(32);csrf=secrets.token_urlsafe(32);SESSIONS[token]={'csrf':csrf,'expires':time.time()+8*3600};ATTEMPTS.pop(ip,None)
    secure='; Secure' if os.environ.get('ARIRANG_HTTPS')=='1' else ''
    return self.reply({'csrf':csrf},cookie=f'arirang_session={token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=28800{secure}')
   s=self.session()
   if not s:return self.reply({'error':'관리자 로그인이 필요합니다.'},401)
   if not hmac.compare_digest(self.headers.get('X-CSRF-Token',''),s['csrf']):return self.reply({'error':'세션 검증 실패'},403)
   if self.path=='/api/logout':
    c=SimpleCookie(self.headers.get('Cookie',''));SESSIONS.pop(c['arirang_session'].value,None);return self.reply({'ok':True},cookie='arirang_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0')
   zone=self.path.rsplit('/',1)[-1]
   if zone not in ZONES:return self.reply({'error':'영역 없음'},404)
   b=self.body()
   if self.command=='PUT' and self.path.startswith('/api/zone/'):
    validate_zone(b);v={k:b[k] for k in ['steps','checks','contractors','costs']};return self.reply(update(zone,v,b.get('version'),'zone'))
   if self.command=='POST' and self.path.startswith('/api/photo/'):
    import datetime
    datetime.date.fromisoformat(b['date'])
    if not isinstance(b.get('note'),str) or not b['note'].strip() or len(b['note'])>1000:raise ValueError('작업 기록을 확인하세요.')
    if not isinstance(b.get('image'),str):raise ValueError('사진 형식 오류')
    m=re.fullmatch(r'data:image/(jpeg|png|webp);base64,(.+)',b['image'])
    if not m:raise ValueError('JPEG/PNG/WebP 사진만 가능합니다.')
    raw=base64.b64decode(m[2],validate=True)
    if len(raw)>8*1024*1024:raise ValueError('사진은 8MB 이하여야 합니다.')
    valid=(m[1]=='jpeg' and raw.startswith(b'\xff\xd8\xff')) or (m[1]=='png' and raw.startswith(b'\x89PNG\r\n\x1a\n')) or (m[1]=='webp' and raw[:4]==b'RIFF' and raw[8:12]==b'WEBP')
    if not valid:raise ValueError('사진 내용과 형식이 일치하지 않습니다.')
    name=secrets.token_hex(16)+'.'+('jpg' if m[1]=='jpeg' else m[1]);folder=DATA/'uploads';folder.mkdir(exist_ok=True);p=folder/name;p.write_bytes(raw)
    try:return self.reply(update(zone,{'url':'/uploads/'+name,'date':b['date'],'note':b['note'],'created':time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime())},b.get('version'),'photo'))
    except:p.unlink(missing_ok=True);raise
   return self.reply({'error':'경로 없음'},404)
  except (ValueError,KeyError,TypeError,json.JSONDecodeError) as e:return self.reply({'error':str(e)},400)
  except Exception:return self.reply({'error':'저장 중 오류가 발생했습니다.'},500)
 do_POST=mutate
 do_PUT=mutate
if __name__=='__main__':
 port=int(os.environ.get('PORT','8000'));print(f'The Arirang Store http://localhost:{port}',flush=True);ThreadingHTTPServer((os.environ.get('HOST','127.0.0.1'),port),Handler).serve_forever()
