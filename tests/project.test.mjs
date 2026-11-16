import { test } from 'node:test'
import assert from 'node:assert/strict'
import { newComposition, validateProject } from '../src/studio/storage.ts'
import { HistoryController } from '../src/editor/main/HistoryController.ts'

function fixture() {
  const project = newComposition()
  project.assets = [{ id:'image', name:'test.png', data:'data:image/png;base64,iVBORw0KGgo=', width:32, height:32 }]
  const mesh = { geometry:{position:[0,0,0,1,0,0,0,1,0],uv:[0,0,1,0,0,1],index:[0,1,2]},position:[0,0,0],quaternion:[0,0,0,1],scale:[1,1,1] }
  project.pieces = [{id:'piece',assetId:'image',kind:'drapedPatch',shape:{kind:'aarect',points:[{x:0,y:0},{x:1,y:1}]},mesh,flat:structuredClone(mesh),opacity:.4,contrast:1}]
  return project
}
test('portable geometry, original source and transform round trip',()=>{
  const project=fixture();assert.deepEqual(validateProject(JSON.parse(JSON.stringify(project))),project)
})
test('rejects external images, invalid geometry and dangling source references before loading',()=>{
  for(const mutate of [
    p=>{p.assets[0].data='https://example.invalid/tracker.png'},
    p=>{p.pieces[0].mesh.geometry.index=[0,1,999]},
    p=>{p.pieces[0].mesh.position=[NaN,0,0]},
    p=>{p.pieces[0].assetId='missing'},
    p=>{delete p.pieces[0].flat},
    p=>{p.pieces[0].opacity=2},
    p=>{p.assets.push(p.assets[0])},
    p=>{p.version=2},
  ]) { const p=fixture();mutate(p);assert.throws(()=>validateProject(p)) }
})
test('notifies every edit, even when undo/redo availability is unchanged',()=>{
  let value=0,notifications=0
  const history=new HistoryController({syncActiveToolToTarget(){},refreshBakeAndVisibility(){}})
  history.subscribe(()=>notifications++)
  const command=()=>({execute(){value++},undo(){value--},isUndoable(){return true}})
  history.execute(command());history.execute(command())
  assert.equal(notifications,2);assert.equal(value,2)
  assert.equal(history.undo(),true);assert.equal(value,1)
  assert.equal(history.redo(),true);assert.equal(value,2)
  history.undo();history.execute(command());assert.equal(history.canRedo(),false)
})

test('skin tone is optional for older projects and validated for portable files',()=>{
  const project=fixture()
  assert.equal(validateProject(project).skinTone,undefined)
  project.skinTone=.63
  assert.equal(validateProject(JSON.parse(JSON.stringify(project))).skinTone,.63)
  for(const value of [-.01,1.01,NaN,Infinity,'0.5',null]) {
    assert.throws(()=>validateProject({...project,skinTone:value}))
  }
})
