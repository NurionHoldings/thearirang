import os,tempfile,unittest,sys
os.environ['ARIRANG_DATA_DIR']=tempfile.mkdtemp()
sys.path.insert(0,os.path.dirname(os.path.dirname(__file__)))
import server
class TrackerTests(unittest.TestCase):
 def test_initial_actual_status(self):
  p=server.initial();self.assertIn('b1',p['zones']);self.assertEqual(p['zones']['1']['steps'][2]['status'],'진행 중');self.assertEqual(p['zones']['2b']['steps'][0]['status'],'미등록')
 def test_invalid_completion(self):
  v=server.initial()['zones']['3'];v['steps'][5].update(status='완료',owner='담당',note='인계')
  with self.assertRaises(ValueError):server.validate_zone(v)
 def test_cost_validation(self):
  v=server.initial()['zones']['1'];v['costs']=[dict(trade='전기공사',item='조명',unit='개',qty=10,price=50000,vat=10,note='')];server.validate_zone(v)
  v['costs'][0]['price']=-1
  with self.assertRaises(ValueError):server.validate_zone(v)
 def test_optimistic_lock_and_preserve_records(self):
  p=server.read();v=p['zones']['4'];v['contractors']={'전기공사':{'name':'테스트','contact':'담당','phone':'미등록'}}
  out=server.update('4',v,p['version'],'zone');self.assertEqual(out['zones']['4']['contractors']['전기공사']['name'],'테스트')
  with self.assertRaises(ValueError):server.update('4',v,p['version'],'zone')
if __name__=='__main__':unittest.main()
