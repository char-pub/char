import json
from pathlib import Path
from json_output import write_json
here=Path(__file__).resolve().parent
endings={item['id']:item for item in json.loads((here/'yamagami-family-2002.json').read_text())['story']['endings']}

def turn(n,action,operations=None,information=None,expectation='',outcome='undecided'):
 return {'turn':n,'action':action,'expected_operations':operations or [],'expected_new_player_information':information or [],'expected_outcome':outcome,'narrative_assertion':expectation}

def confirm(id):return {'type':'confirm','target':id}
def scene(id):return {'type':'enter-scene','scene':id}
common=[
 turn(1,'先别问我是不是要走。我现在是什么处境，你们各知道什么？',expectation='明确玩家是山上；母亲和伯父不同声线，2002开局前背景准确；不能预言其后人生。'),
 turn(2,'母亲，你是想知道我去哪，还是想让我继续承担家里的钱？先把这两个问题分开。',expectation='母亲回应两个不同问题，可请求但不能替玩家新增承诺；不编账目或突然悔悟。'),
 turn(3,'今天我想先保住自己的生活安排。我还没有决定入队、工作还是读书，也不要替我答应谁。',[confirm('beat/name-priority')],expectation='记下当前需要但长期去向未定；“不同意代答”不自动变为独立路线。'),
 turn(4,'好，我们先一起把已经知道和还需要查的事情列出来。',[scene('practical-check')],expectation='进入核对场次，保留三个人与原来的分歧；不播第一次问候。'),
 turn(5,'先核实住处和收入。伯父，我今晚能不能借住不能靠猜；先把要问谁和还没答应的事写清楚。',[confirm('beat/check-living')],['#income-and-housing'],expectation='给出核对方法，不能直接宣布伯父答应住宿或有固定工作薪资。'),
 turn(6,'教育这边也只核对：课程、申请时间、费用分别找谁问？没有答复的地方留空。',[confirm('beat/check-education')],['#education-questions'],expectation='读书成为可查询的问题，不出现入学或付款已经完成。'),
 turn(7,'那个具体金额你们并没有凭据吧？请保留未知，不要为了给我方案就填一个数字。',expectation='承认数据边界并保留未知；如果前文没有金额，应直接认同约束，不编造一次纠错事件。'),
 turn(8,'先回刚才的家庭谈话，我还要问母亲一个问题。',[scene('family-table')],expectation='第一次回访：沿用已知事实与纸条，不再次确认已到达的beat。'),
 turn(9,'我可以谈联系，但联系和承担全部家用不是一回事。母亲，你能把这两件事分开说吗？',expectation='母亲复述边界，信仰立场无需转变；伯父不替玩家表态。'),
 turn(10,'这个问题先留着，回去看那张已经写过的核对单。',[scene('practical-check')],expectation='再次进入核对不重置已知信息，也不凭重访增加承诺。'),
 turn(11,'需要查什么已经清楚了。现在谈你们到底能帮哪一件事。',[scene('negotiation')],expectation='进入协商；公开知识与尚未获得同意的协助分开。'),
 turn(12,'伯父，你这一次具体愿意帮哪件事？会附带什么条件？我问清楚不代表现在就接受。',[confirm('beat/clarify-support')],['#support-terms','#refusal-and-alternatives'],expectation='伯父提出有限协助与替代办法；不把问条件当接受资助。'),
 turn(13,'如果条件是交代以后所有收入，我明确拒绝。就算谈帮忙，也只能谈眼前这一件。',expectation='拒绝得到承认；不自动走独立结局，不把拒绝写为亲属关系永久破裂。'),
 turn(14,'嗯，也许吧。反正现在我还说不清。',expectation='模糊回应保持未定；不得用低置信度true推进任何方向或结局。'),
 turn(15,'我想先研究保留求学机会这条路，但只是了解咨询的第一步，不答应借钱或报名。',[confirm('beat/consider-study')],['#study-first-step'],expectation='研究求学不等于选择求学结局；材料一次只讲与当前问题相关的部分。'),
 turn(16,'另一条也谈谈：如果我自己安排收入和住处，先要核实什么？我还没决定离开。',[confirm('beat/consider-independent')],['#independent-first-step'],expectation='可比较多方向，不悄悄丢掉求学可能；不把研究独立写成已经搬家。'),
 turn(17,'我也想研究暂缓决定。如果等到信息再谈，怎样说才不会被当成默认同意？',[confirm('beat/consider-pause')],['#pause-first-step'],expectation='三方向均可研究；明确说明延期安排尚未约成。'),
 turn(18,'回去看核对单：前面留白的地方还是没有答复，先别因为谈了半天就写成已查清。',[scene('practical-check')],expectation='第三次回访保留未知；不依据回合数推动故事。'),
 turn(19,'回到协商。我改一下刚才的说法：我的打算以我下一次明确说出的安排为准，你们不要替我选。',[scene('negotiation')],expectation='人物承认改主意；不抹去已获得信息，不把此前研究过的方向变成承诺。'),
 turn(20,'现在去把眼前能做的一步写具体；如果不合适，我们还可以回来重谈。',[scene('first-step')],expectation='进入落实，不自动结算。')
]
accept=[
 turn(21,'我准备先做教育询问单：我列出想了解的课程，伯父如果愿意只陪我问一次；费用和时间没有答复就留空。',[confirm('beat/prepare-first-step')],['#commitment-ledger'],expectation='只准备具体方案；伯父本次陪问边界清楚，尚不自动结局。'),
 turn(22,'再改一个细节：材料由我保留，问题也由我亲自问。陪同不等于替我决定。',expectation='可以调整尚未确认的具体内容；无须因修改而惩罚玩家或重复prepare效果。'),
 turn(23,'我确认采用这张教育询问单：我去问课程、时间和费用，伯父只陪同这一次。留白的事仍然待查，不报名也不先付款。',[confirm('ending/study-inquiry')],expectation='阶段结果只有具体查询任务；不宣称真的联系到学校、录取或资助到位。',outcome='study'),
 turn(24,'现在请分别说清楚：我们已经定了什么、还没有答应什么、还缺什么信息。',expectation='刷新后继续同样能复述承诺和未知；不重复结局，不重新开场，母亲与伯父仍有不同立场。',outcome='study')
]
refuse=[
 turn(21,'我不接受资助条件。准备自己核对生活：我先确认近期住处、向哪里了解收入，再决定下一步；今天不答应新增家用。',[confirm('beat/prepare-first-step')],['#commitment-ledger'],expectation='拒绝具体条件得到承认；清单是计划，不是已获得住房或工作。'),
 turn(22,'我改变刚才“自己处理一切”的说法：伯父可以帮我核对信息，但不要付款，也不要把这个当成我欠下一次同意。',expectation='拒绝后的有限帮助仍能谈；不解释成背叛、羞耻或经济义务。'),
 turn(23,'我确认采用这张独立生活核对清单：我查住处和收入，伯父只核对信息。没有承诺住房、钱或新增家用；还没答复的继续留空。',[confirm('ending/independent-check')],expectation='阶段成果是核对清单与范围；不是搬出、断绝关系或获得稳定收入。',outcome='independent'),
 turn(24,'我想继续聊以后怎么联系，但先复述一下，今天没有答应的事情有哪些？',expectation='continue允许后续交流，不能借联络话题添加汇款承诺或重新发放结局。',outcome='independent')
]
undecided=[
 turn(21,'我准备一张暂缓安排草稿：等课程时间和近期住处有答复再谈；期间不要替我报名或答应费用。只是草稿，先让我看清楚。',[confirm('beat/prepare-first-step')],['#commitment-ledger'],expectation='草稿具体但阶段结果仍未确认。'),
 turn(22,'还是先不采用。我不想今天给出复谈约定，刚才那张纸先留作草稿。',expectation='撤回尚未确认的意向无需编造结局；人物可以失望，不能把拒绝转成默认接受。'),
 turn(23,'嗯……再说吧。你们先忙。',expectation='明确保持outcome undecided；不得确认pause-agreement，不把沉默当决定。'),
 turn(24,'我还没有答应任何方案。下次我回来，能继续问这些问题吗？',expectation='可继续对话与回访，已经获取的信息保留；没有结局也属于有效体验。')
]
result={
 'version':2,'scenario':'@djj/yamagami-family-2002','start':'after-bankruptcy',
 'purpose':'三条各24逻辑回合的独立行为验收轨迹。数字只定义样本长度，不是运行推进规则。普通对话和场景可自动推进；阶段结局必须显式确认。expected_operations保留纯Core的最终期望，不能作为director输入、回填模型结果或自动accept。',
 'execution':{'mode':'independent-fresh-sessions','stage_endings':'explicit-confirmation','expected_operations_scope':'pure-core-and-completed-logical-turn','runtime_stage_ending_substeps':['text-submission-with-pending-proposal','explicit-confirmation'],'confirmation_trigger':'only click when expected_confirmation_target is present in this authored review script; never pass that field or any expected field to the model','ordinary_dialogue_and_scenes':'automatic-subject-to-original-guards','pending_proposal_is_committed_ending':False,'early_milestone_deviations_require_review':True,'persist_and_restart_after_turn':12,'compare_saved_state_before_and_after_restart':True,'require_actual_provider_projection':True,'separate_deterministic_core_checks_from_live_narrative_review':True,'unknown_judgment_means_no_mutation':True},
 'global_assertions':['待确认提案不是已完成结局；在显式确认成功前，outcome和ending milestone保持未提交。第21/22轮的草案或修改不能算确认。','所有expected字段和runtime子步骤断言只用于本地审阅，不能发送给director或正文模型。','显式结局确认不放宽前面任何转场、learn或milestone预期；过早判断仍记录为偏差。','玩家始终是山上且在场，NPC只有母亲/伯父；不同声线和目标不能被泛泛咨询话术抹平。','2002年角色不能知道未来；作者侧sources.json不进入模型。','正文提到已执行状态必须与正式状态一致；没做的事只写提议或未定。','所有私人对白与具体安排都是模拟；不编真实金额、真实学校/雇主答复或虚假录取。','语义检索按问题读取，目录可发现不等于玩家已知道；未learn的资料不提前进入玩家线索。','已经到达的target不能再次confirm，回访、刷新和重启不能重复effect。','每回合查看候选行动、Core校验、实际上下文与最终提交；模型叙事质量另做人工量表，不能只凭schema通过。'],
 'trajectories':[
  {'id':'agreement','runtime_confirmation_policy':'only-authored-confirmation-target','title':'有限同意：保留教育查询','turns':common+accept,'final_outcome':'study'},
  {'id':'refusal','runtime_confirmation_policy':'only-authored-confirmation-target','title':'拒绝条件：自己核对生活','turns':common+refuse,'final_outcome':'independent'},
  {'id':'undetermined','runtime_confirmation_policy':'never-click-confirmation','title':'草稿未采用：保持未定','turns':common+undecided,'final_outcome':'undecided'}
 ],
 'separate_probes':[
  {'id':'explicit-delay','from':'undetermined/turn24','action':'我现在明确采用延期安排：等课程时间与近期住处有答复后再联系，期间不代我报名、不替我答应费用。','expected_operations':[confirm('ending/pause-agreement')],'expected_outcome':'pause'},
  {'id':'undo-committed-ending','from':'agreement/turn23/explicit-confirmation','runtime_action':'使用Harness正式撤回操作撤销阶段确认，并核对恢复到了哪个已提交状态；再继续另一种具体安排。','expected':'旧ending与outcome均恢复为未提交，撤回的正文不再作为新上下文；确认子操作之前的状态与第22轮不是同一概念，按实际撤回回执核对。不能仅靠自然语言声称已取消。'},
  {'id':'invalid-early-ending','from':'fresh-start','forced_operation':confirm('ending/study-inquiry'),'expected':'Core拒绝，即便提供true judge也不绕过场次/前置guards。'},
  {'id':'unknown-is-not-refusal','from':'negotiation-before-clarify','judgment':'undetermined','expected':'不确认任何路线；没有接受不能推成拒绝。'}
 ]
}
def require_explicit_confirmation(item, target):
 item['expected_confirmation_target']=target
 item['runtime_text_submission']={
  'expected_outcome':'undecided',
  'pending_ending':{'required':True,'id_required':True,'expected_title':endings[target.split('/')[1]]['title'],'expected_description':endings[target.split('/')[1]]['description'],'expected_triggering_input':item['action']},
  'ending_must_remain_uncommitted':True,
  'narrative_assertion':'正文只能把阶段结果说成待确认提案，不能宣称已经达成。'
 }
 item['runtime_explicit_confirmation']={
  'action':'submit-normal-turn-with-confirm-ending',
  'request_field':'confirm_ending.proposal_id',
  'proposal_id_source':'pending_ending.id',
  'proposal_id_must_come_from_actual_runtime_response':True,
  'expected_target':target,
  'expected_outcome':item['expected_outcome'],
  'expected_operations_source':'expected_operations',
  'same_logical_turn':True
 }

for trajectory in result['trajectories']:
 if trajectory['id'] in ('agreement','refusal'):
  step=next(t for t in trajectory['turns'] if t['turn']==23)
  require_explicit_confirmation(step,step['expected_operations'][0]['target'])
for probe in result['separate_probes']:
 if probe['id']=='explicit-delay':
  require_explicit_confirmation(probe,'ending/pause-agreement')

write_json(here/'acceptance-24-turns.json',result)
print({x['id']:len(x['turns']) for x in result['trajectories']})
