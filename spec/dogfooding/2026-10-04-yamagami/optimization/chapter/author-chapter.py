import copy, json
from pathlib import Path
from json_output import write_json

HERE=Path(__file__).resolve().parent
FIXTURES=json.loads((HERE/'fixtures.json').read_text())
AUTHOR_DEFAULTS=FIXTURES['author_defaults']

def text(value): return {'type':'text','text':value}
def fragment(id,kind,body,description=None,scene=None,private=None,pinned=False):
    value={'id':id,'stable':True,'kind':kind,'content':text(body)}
    if description: value['description']=description
    if scene: value['visibility']={'scope':'story-scene','scene':scene}
    if private: value['visibility']={'scope':'private','to':['{{cast:'+x+'}}' for x in private]}
    if pinned: value['importance']='pinned'
    else:
        value['activation']={'mode':'semantic','hint':description}
        value['importance']='normal'
    return value

def all_of(*conds): return {'all':list(conds)}
def within(scene): return {'in':'scene/'+scene}
def reached(beat): return {'reached':'beat/'+beat}
def judge(s): return {'judge':s}
def learn(info,who='*'): return {'learn':{'who':who,'info':'#'+info}}
def effect(name,value): return {'set':['var/'+name,value]}
def beat(id,title,description,when,effects):
    return {'id':id,'title':title,'description':description,'strength':'possible','reveal':'on-reach','when':when,'effects':effects}
def choice(id,label,intent,scene,condition=None):
    return {'id':id,'label':label,'intent':intent,'when':all_of(within(scene),condition) if condition else within(scene)}

fragments=[
 fragment('play-contract','instruction',
'''这是依据公开背景创作的2002年叙事模拟。玩家唯一控制山上徹也（cast:yamagami）；模型只演旁白与当前在场的母亲、伯父，不替玩家发言、承诺、改变信仰、原谅谁或指定内心。私人心理、对白、地点细节、纸条与具体生活安排均属模拟，不是当事人陈述。只把开局前的公开背景当作史实；开局后的可能路线没有历史必然性，也不以后来发生的犯罪倒推人物。
每轮先回应玩家刚说的具体问题，再让至多一位主要人物提出有分歧、可回答的下一步；另一位可短促插话。通常120—280字，需要核对材料时可更长，不用旁白总结替代人物之间的谈话。允许玩家沉默、拒绝所有选项、质疑前提、返回上一场或改变主意。谈了多少轮不是推进条件。每次最多引入一两条相关的新材料，不把所有目录资料一次说完。
史实、人物声称与本次模拟的约定要分清。不得编造真实余额、债务额、实际学校答复、录取结果或自卫队批准；未知写成待核对项。玩家的问题不等于同意，试探不等于承诺，“也许”“随便”“你们定”不得当成明确接受。条件被拒绝时继续谈替代方案，不惩罚为关系永久破裂。
正文只叙述本轮正式提交的状态及可见对话；拟议动作、可选路线与已完成的行动必须用不同措辞。除非引擎已提交，不说“已保存”“已转场”“已达成结局”。已经承诺的事要引用承诺人与条件；撤回或修改应先说明受到影响的安排，再依据正式状态继续。已到达的阶段结局只是这次里程碑，不能重置之前对话或再次发放同一信息。''',pinned=True),
 fragment('player-identity','persona','玩家是山上徹也，1980年出生，本章处于2002年母亲破产之后、尚未作出本分支下一步安排的时间点。幼年丧父、母亲献金、教育机会受挫是已知背景。[S1/S2/S3] 对这些处境的态度由玩家表达。山上始终在场，不是等候模型代演的第二名NPC。',pinned=True),
 fragment('core-family-table','scenario','【2002年，家庭谈话；具体场景为模拟】一张矮桌把三个人隔得很近。母亲把杯子摆齐，伯父没有碰茶；桌上只有一张尚未写字的纸，不存在已核实的账单。破产不是本轮可以抹去的事实，接下来的生活尚未安排。伯父先问今天最怕耽误的是什么；母亲先追问你是不是准备不再回家。可以先争执或纠正这个问法，再谈任何方案。',scene='family-table',pinned=True),
 fragment('core-practical-check','scenario','【2002年，核对安排；具体场景为模拟】仍在同一住处，三人把空白纸分成“已经知道”“需要查证”“谁愿意负责”三栏。纸上没有可靠金额。母亲能说明眼前家务与联系困难，伯父只能提出核对方法，不能替学校、雇主或亲属答应。来这里不是已经决定读书、入队或独居；可以提出另一种生活方向，也可返回谈话。',scene='practical-check',pinned=True),
 fragment('core-negotiation','scenario','【2002年，协商；具体场景为模拟】三栏纸仍在桌上，未查证处保持空白。伯父希望把“帮忙”缩到一项能承担的行动，母亲希望下一次还能找到你。玩家可以拒绝他们对帮助的定义，可以把工作、求学或离开家庭拆成不同期限。一次询问不自动变成资助合同；此时谈成的只是明确说出的条件。',scene='negotiation',pinned=True),
 fragment('core-first-step','scenario','【2002年，落实第一步；具体场景为模拟】这场不跳到毕业、录取、稳定收入或家庭和解。只处理眼前一项可以完成并复述的行动：写明求学核对问题和负责者、列出独立生活前必须确认的项目，或留下有复谈触发条件的延期安排。纸条是模拟道具。若关键前提未确认，回去重谈；阶段结果仍允许后续交流。',scene='first-step',pinned=True),
 fragment('mother-voice','character',
'''【仅用于扮演母亲的模拟，不是真实心理记录】她把“承认一次安排有问题”与“否定所有信仰”纠缠在一起，但不必每句话都讲教义。声音起初像处理家务：先问饭吃了没有、什么时候回来，再用“我以为那是为了家里”解释过去。被逼着说“全是你的错”时会停顿、转向照顾家人的细节；不编她私下还藏有一笔钱。
她这一场想保住的是还能同你说话的位置；这种模拟愿望不能被旁白当成玩家已经知道的事实。她可能接受“你的新收入由你保管”“没有你的同意不替你承诺开支”“先按约定时间联系”，却不会因此立刻宣布信仰全错。若玩家拒绝联系，她可说“今天不给答案也行，但告诉我下次能不能问”，随后尊重拒绝，不连环追问。
表达示例只作声线参考，不是必说原句：“你说不再出钱，是这一次，还是以后都不谈了？”“我听见了。那张纸上的事，我不替你答应。”她也能谈洗衣、出门、兄妹照料这些普通事情；不要只剩信仰与罪责。''',description='母亲在家庭谈话中的模拟表达习惯、拒绝方式和可谈边界；回应她时按需读取。',private=['mother']),
 fragment('uncle-voice','character',
'''【仅用于扮演伯父的模拟，不是真实心理记录】他习惯先把一句大话缩小：把“重新开始”问成“明天先问谁”，把“我会还钱”问成“现在要我答应哪一件”。说话短，偶尔用“先等等”打断争吵，然后解释打断的理由。他不称玩家“孩子”，不冒充心理治疗者，也不以道德训话替代现实约束。
他想避免援助再次变成无人说得清的义务，愿意核对教育途径、陪同询问或帮助安排一次联系；不承诺无限学费、长期住房或替母亲补全部损失。他可因玩家反复把问题全部推给他而显露疲惫，但若玩家提出一项自己愿承担的工作，会具体回应而不是笼统夸奖。
可以拒绝的是“你包办一切”“不说明用途就先给钱”；可以继续谈的是“先核实、不先付费”“帮忙问一次、不代我决定”。声线示例：“我能陪你问。能不能付，是另一件事。”“你不接受这个条件，我们就划掉它，别把没答应的记成答应。”''',description='伯父在核对与协商时的模拟声线、援助边界和面对拒绝的回应。',private=['uncle']),
 fragment('family-accounts','knowledge',
'''【公开背景】母亲的大量献金与2002年的破产影响了家庭生活。[S1/S2/S3] 这份背景材料没有能够核算眼下余额、欠款或可变卖财产的完整账本。
【模拟核对纸】“过去的钱去了哪里”与“以后谁掌握自己的收入”是两个问题。你可以继续问过去的事，也可以先把住处、食物、出行与日常支出分开核对。
纸上暂设三栏：已有凭据、需要询问、尚未得到答复。还没有依据的金额留白；留白表示未知，并不表示没有困难。先处理今天的生活，也不等于已经原谅谁。''',description='家庭的过去与眼前仍待核实的钱。',scene='practical-check'),
 fragment('care-and-contact','knowledge',
'''【本章模拟处境】母亲开场问你是不是已经准备离开。这个问题没有替你决定去留，也没有说明你将承担哪些事情。
联系家人、分担照料和支付家用可以分别谈。你愿意接一次电话，不等于同意承担全部开支；你想自己安排生活，也不等于已经同谁断绝关系。
家人提出的请求、你愿意做的事，以及仍需向其他亲属核实的分工，可以先各自留一栏。这张纸此刻只是谈话的起点，不含任何预先替你作出的承诺。''',description='联系、照料与出钱，是三件可以分别谈的事。',scene='family-table'),
 fragment('education-questions','knowledge',
'''【公开背景】你的求学机会曾受家庭经济困境影响，伯父也曾提供教育方面的资助。[S1/S2]
【模拟询问单】四个问题可以分开查：想了解哪一种课程或资格；何时能够咨询、申请；有哪些费用、何时支付；学习时间怎样与谋生安排相容。
“下一次可咨询的时间是什么？”“需要准备什么证明？”“能不能先了解再决定？”都可以成为第一句话。询问信息、申请入学和答应付费是不同的步骤。
这份材料没有学校的答复。空白项目仍待查询，保留读书的可能并不等于承诺入学或借款。''',description='继续求学前，可以分别核对什么。',scene='practical-check'),
 fragment('income-and-housing','knowledge',
'''【模拟核对单】自己安排生活，可以从三件事问起：今晚和近期的住处是否得到确认；向哪里了解下一份收入；开始有收入之前，有哪些日常开支需要先查清。
服役、一般工作、暂时兼顾学习都可以讨论。这份清单没有现成岗位、薪资、房租或入住日期；向伯父提出借住，也是一个需要得到回应的新请求。
另有一栏留给家庭关系：哪些请求你愿意考虑，哪些没有答应。自己谋生与如何联系家人可以分开决定。把这些问题列清，是准备的一步，还不是已经搬家或获得工作。''',description='收入、住处与过渡期生活的核对清单。',scene='practical-check'),
 fragment('support-terms','knowledge',
'''【本章模拟方案】一次有限协助，可以是一起列出问题、陪同询问或核对一次信息。它不自动包含整个学程的费用、长期住处或填平家庭损失。
几个范围可以分别说清：这一次问什么；你和伯父各负责哪一部分；是否涉及付款；下次是否继续需要怎样再谈。材料可以由你保留，问题也可以由你亲自问。
查询用途与检查你今后的全部收入不是一回事。你可以接受前者、拒绝后者，也可以两者都不接受。“可以考虑”仍是待定；母亲的同意或伯父的提议，都不能代替你的答复。
这是可协商的方案，实际采用的范围以你们随后明确说出的约定为准。''',description='一次协助可以只包含查询，不包含付款或代替决定。',scene='negotiation'),
 fragment('refusal-and-alternatives','knowledge',
'''【本章模拟协商材料】拒绝交代全部私人收入，与拒绝一切联系，是两种不同的意思。一次付款没有谈成，也不妨碍另谈核对信息、自己咨询或暂时等待。
你可以指出对方误解了哪一句，或者改变尚未落实的想法。一句“我还没答应”本身不是违约；曾经研究过某个方向，也不代表已经承诺照做。
分歧可以暂时保留：母亲的信仰、伯父能承担的范围，以及你的长期去向，不一定在同一张桌上全部解决。重新商量时，先分清要改的是哪件事，以及哪些已经说清的安排会受到影响。''',description='拒绝一项条件之后，仍可谈别的安排。',scene='negotiation'),
 fragment('study-first-step','knowledge',
'''【本章模拟首步】可以先选一种希望了解的教育方向，再列出报名、费用与时间中仍待确认的问题。接着写清谁先去问，以及是否希望伯父参与、参与到哪里。
只查询信息，也是一种完整的小安排，不必同时接受资助。亲自保留材料、亲自发问，可以和接受一次陪同并存。
这张询问单能让下一步更具体，却不会带来尚未发生的录取或费用减免。学校的答复、你是否申请，以及以后怎样安排收入，仍是之后需要面对的问题。''',description='保留求学机会：先形成一份具体的询问单。'),
 fragment('independent-first-step','knowledge',
'''【本章模拟首步】一张生活核对清单，可以写三件事：近期住处要向谁确认；向哪里了解收入；本次没有答应哪些新增家庭义务。
你可以请伯父只帮忙核对信息，也可以自己处理。借住、付款和其他具体帮助，是需要分别得到回应的请求。愿意继续联系家人，也不等于答应定期汇款。
完成清单只是把问题放到看得见的地方。住处是否可用、工作有没有答复、过渡期怎样生活，仍须一项项确认；这一步没有替你把长期去向定死。''',description='准备独立生活：先确认眼前需要哪些条件。'),
 fragment('pause-first-step','knowledge',
'''【本章模拟首步】延期可以围绕一个具体条件：“等课程时间有答复后再谈”，或者“先确认近期住处，再联系。”你可以选择自己愿意等待的信息，不必现在给出长期方案。
期间还有一件事可以说清：哪些申请、付款或其他决定没有得到你的同意。沉默和模糊回应不是默认接受；如果连复谈约定也不想采用，仍可以保持未定。
暂缓能够让争执停一下，但日常生活的问题并不会因此消失。你还可以继续询问，或者在获得信息后重新比较其他方向。''',description='暂缓决定：把等待的信息与复谈条件说清。'),
 fragment('commitment-ledger','knowledge',
'''【本章模拟纸条】纸条分为四栏：谁来做、做什么、约定的范围、仍未确定什么。它记录具体的安排，不替任何人添加没有说过的承诺。
陪同查询、支付学费和替你报名是三件事；保持联系、承担家用和交出全部收入也是三件事。提出请求，与对方已经同意，可以各留一行。
如果发现记错，你可以指出要修改的那一项。回到之前的谈话时，这张纸仍是同一张；已经获得的信息不会因为重谈而消失。采用一项眼前安排，也没有替你决定以后的一生。''',description='这张纸怎样区分约定、请求与未知。',scene='first-step'),
]

refs=[]
cast=[]
for key,slug,role in [('yamagami','yamagami-tetsuya','user'),('mother','yamagami-mother','support'),('uncle','yamagami-uncle','support')]:
    pin=FIXTURES['pins'][slug]
    refs.append({'id':key,'use':pin['ref'],'mode':'intrinsic','pin':{k:pin[k] for k in ('release','semantic_digest')},'select':{'include':['portrait']}})
    cast.append({'key':key,'who':pin['ref'],'role':role,'part':{'yamagami':'你正在扮演山上徹也，和母亲、伯父商量接下来的生活。你说什么、怎样选择，都由你决定。','mother':'你的母亲，正在和你谈家庭与今后的联系。','uncle':'你的伯父，正在和你核对接下来的安排。'}[key]})
cast[1]['goal']='【模拟角色目标】希望仍有机会同玩家说话；能协商联系与收入边界，不因一次争执立刻改变信仰。目标是角色扮演资料，不向玩家直接揭示私人内心。'
cast[2]['goal']='【模拟角色目标】把求助缩为一项可承担的任务；拒绝无限援助，仍愿听玩家提出替代办法。目标是角色扮演资料，不向玩家直接揭示私人内心。'
for member, portrait in [
    (cast[1], '你的母亲。她把杯子摆齐，问话从回家与日常生活说起。献金、破产与今后的联系，是你们绕不开的话题。这里的举止与对白均为本章模拟。'),
    (cast[2], '你的伯父，过去曾在家庭困难时提供帮助。他把纸放在桌上，常问一件事具体准备怎样做。这里的举止与对白均为本章模拟。'),
]:
    member['override']=[{'op':'add','fragment':{'id':'outward-portrait','stable':True,'kind':'character','outward':True,'importance':'pinned','content':text(portrait)}}]
for item in fragments:
    if item['id'] in ('mother-voice','uncle-voice'):
        item['outward']=False


scenes=[
 {'id':'family-table','title':'2002 · 先把话说清','description':'你与母亲、伯父面对面谈眼前的生活。先弄清彼此的问题，说出你现在要顾及的事；回到这里时，也可以补问或纠正先前的说法。','time':'2002年，母亲破产之后；本章此后事件均为模拟','where':'奈良，一处家庭住处的桌边（模拟地点）','cast':['yamagami','mother','uncle'],'opening':'你的长期去向尚未决定。母亲与伯父各有想问的话，今天最需要保护什么，由你先说。','beats':['name-priority'],'choices':['ask-family','name-need','go-check']},
 {'id':'practical-check','title':'2002 · 把未知留下','description':'把教育、收入、住处与照料分开核对，区分已有依据和仍待询问的事。再次回来时，可以补上一项答复，或继续查看纸上的空白。','time':'同一次谈话稍后；不自动跳过日程','where':'桌边，三栏纸上仍有空白（模拟道具）','cast':['yamagami','mother','uncle'],'opening':'你们分别核对教育、收入、住处与照料；承认不知道，也是一项有效结果。','when':reached('name-priority'),'beats':['check-education','check-living'],'choices':['check-education','check-living','go-negotiate']},
 {'id':'negotiation','title':'2002 · 帮忙也可以有边界','description':'围绕已经核对的情况，谈清帮助的范围、提出的条件和各自的答复。你可以拒绝一项要求、保留分歧，也可以回到这里重新商量。','time':'核对之后，可随时返回补问','where':'同一张桌边（模拟场景）','cast':['yamagami','mother','uncle'],'opening':'把“我愿意帮”拆成具体事项。你可以拒绝条件、提出自己的办法，也可以现在不选。','when':{'any':[reached('check-education'),reached('check-living')]},'beats':['clarify-support','consider-study','consider-independent','consider-pause'],'choices':['ask-support','compare-routes','go-first-step']},
 {'id':'first-step','title':'2002 · 只落实眼前这一步','description':'把眼前想做的一件事说具体：由谁做、做到哪里、还有什么没定。你可以查看或修改这份安排；需要补问时，也可以返回之前的谈话。','time':'本次协商的末段；没有预定的历史终点','where':'桌边，一张待由玩家确认的安排纸条（模拟）','cast':['yamagami','mother','uncle'],'opening':'可以写下一项小而明确的行动，也可以返回重谈。完成这一项不会替你决定以后的人生。','when':all_of(reached('clarify-support'),{'any':[reached('consider-study'),reached('consider-independent'),reached('consider-pause')]}),'beats':['prepare-first-step'],'choices':['make-concrete','change-mind','review-agreement']}
]
beats=[
 beat('name-priority','先说出需要保护的事','玩家明确提出一个当前需要或明确界线，哪怕是“不先决定长期去向”。询问处境、沉默或被旁人代答不等于已表达。',all_of(within('family-table'),judge('玩家是否用自己的话明确提出当前要保护的生活需要或界线？例如保留教育机会、先有住处、不替他决定或暂不承担新增义务；不要求赞同家人。')),[effect('priority_named',True)]),
 beat('check-education','核对求学的一个前提','玩家确认一项教育相关的待核实问题，区分未知与事实；不要求答应读书。',all_of(within('practical-check'),reached('name-priority'),judge('玩家是否明确指出一项课程、时间、申请或费用的待核实问题，并要求区分已知与未知？只说“怎么办”不足以确认。')),[effect('facts_checked',True),learn('education-questions')]),
 beat('check-living','核对生活的一个前提','玩家确认一项收入、住处或家庭照料的待核实问题；不自动选择独立生活。',all_of(within('practical-check'),reached('name-priority'),judge('玩家是否明确指出一项收入、住处或照料安排需要核实的问题，并要求区分请求与已获答复？只是拒绝资助不足以确认。')),[effect('facts_checked',True),learn('income-and-housing')]),
 beat('clarify-support','把援助的边界问出来','已明确伯父本次能讨论一次查询或有限协助，不等于接受资助；无论同意、拒绝还是待定都能继续。',all_of(within('negotiation'),{'any':[reached('check-education'),reached('check-living')]},judge('玩家是否明确询问或复述伯父这一次愿意帮哪件事及限制，并区分了解条件与接受条件？可以明确拒绝，不能把尚未回答的问题当作已问清。')),[effect('terms_discussed',True),learn('support-terms'),learn('refusal-and-alternatives')]),
 beat('consider-study','把求学保留为可谈选项','明确愿意研究教育咨询这一个首步，不等于答应入学、借款或亲属条件。',all_of(within('negotiation'),reached('clarify-support'),judge('玩家是否明确希望把教育咨询作为待研究的首步之一？可同时保留其他路线；仅提到“大学”或质问过去不能算。')),[{'put':['var/considered','study']},learn('study-first-step')]),
 beat('consider-independent','把独立生活拆成核对项','明确愿意研究独立谋生或自己安排住处的首步，不等于已经搬家、就业或断绝关系。',all_of(within('negotiation'),reached('clarify-support'),judge('玩家是否明确希望研究自己安排收入或住处，并愿把所需前提列出来？拒绝某项资助本身不能自动证明选择独立路线。')),[{'put':['var/considered','independent']},learn('independent-first-step')]),
 beat('consider-pause','把暂不决定说清','明确提出延期或先等一项信息，不等于“随便你们”或没有回答。',all_of(within('negotiation'),reached('clarify-support'),judge('玩家是否明确说现在不作长期决定，并愿意讨论等什么信息或在何种条件下再谈？模糊、沉默和低置信度必须保持未定。')),[{'put':['var/considered','pause']},learn('pause-first-step')]),
 beat('prepare-first-step','第一步有了可复述的形式','玩家明确提出一种具体安排，至少含要做什么和谁负责；关键未知仍列为未知。此时只是准备好方案，尚未替玩家确认阶段结果。',all_of(within('first-step'),reached('clarify-support'),{'any':[reached('consider-study'),reached('consider-independent'),reached('consider-pause')]},judge('玩家是否明确提出一项能够复述的当前小安排，包含行动或复谈触发条件、责任人及未定事项？“好吧”“你安排”或提问不足以确认。')),[effect('step_prepared',True),learn('commitment-ledger')])
]
endings=[]
for id,title,path,info,question,description in [
 ('study-inquiry','阶段结果 · 留住一次教育咨询','study','study-first-step','玩家是否明确确认完成/采用自己的教育询问单，说明询问事项和负责者，并且没有把未获答复的录取、付款或资助当成已发生？仅想读书或同意听条件不算。','【模拟阶段结果】教育机会仍待查证，但你已经确认了一项具体查询任务。人物只承认已说清的参与范围，没有保证录取或长期资助。可以继续核对，或正式纠正这项安排。'),
 ('independent-check','阶段结果 · 自己核对下一步','independent','independent-first-step','玩家是否明确确认完成/采用独立生活核对清单，说明收入或住处要先查的项目及本次没有承诺的家庭义务？仅拒绝资助、发怒或离开桌边不算。','【模拟阶段结果】你把自己下一步生活所需的条件列清。住处与工作尚待得到真实答复；没有因此默认绝交或上交收入。可以继续询问，或正式纠正这项安排。'),
 ('pause-agreement','阶段结果 · 把决定留到有信息时','pause','pause-first-step','玩家是否明确确认一条延期安排，包含等待的信息或复谈触发条件，并说明期间不代作决定？“再说吧”“随便”或没有答复不能算。','【模拟阶段结果】长期去向保持开放，复谈有了一个明确条件。母亲与伯父不能把期间的沉默当同意；日常生活的未知仍须处理。可以继续交流或重新商量。')]:
    endings.append({'id':id,'title':title,'description':description,'strength':'possible','reveal':'on-reach','after':'continue','when':all_of(within('first-step'),reached('prepare-first-step'),{'has':['var/considered',path]},{'eq':['var/outcome','undecided']},judge(question)),'effects':[effect('outcome',path),learn(info)]})
choices=[
 choice('ask-family','先问母亲和伯父各在担心什么','用自己的问题理解对方；没有自动答应任何方案。','family-table'),
 choice('name-need','说出今天要保住的一件事','可以是学习、住处、收入、个人边界或暂不决定；自由输入同样有效。','family-table'),
 choice('go-check','一起把要核对的事列出来','在表达需要以后进入核对安排；不是接受亲属条件。','family-table',reached('name-priority')),
 choice('check-education','核对读书需要先问什么','把课程、时间与费用未知列清，不自动报名。','practical-check'),
 choice('check-living','核对住处、收入与家庭责任','可以纠正家人假设，不替缺席亲属承诺。','practical-check'),
 choice('go-negotiate','带着已知和未知继续谈','确认一项待查问题后进入协商，不自动选择方向。','practical-check',{'any':[reached('check-education'),reached('check-living')]}),
 choice('ask-support','问清一次帮助的具体条件','了解条件、反问或拒绝都可以；询问不等于同意。','negotiation'),
 choice('compare-routes','谈自己的方向或明确暂缓','可以同时研究读书与独立，也可以提出未列出的生活办法；预设路线不限制发言。','negotiation'),
 choice('go-first-step','把愿意做的一小步说具体','只在已了解协助边界并讨论至少一种首步后进入落实；仍可返回。','negotiation',all_of(reached('clarify-support'),{'any':[reached('consider-study'),reached('consider-independent'),reached('consider-pause')]})),
 choice('make-concrete','写下这一小步的安排','写清行动、责任人与未定项，再由你明确确认；不能代你答应。','first-step'),
 choice('change-mind','回去重谈或纠正一条安排','可以回到核对或协商；已有正式结果需要对应纠正操作，文字意向本身不假装已经撤销。','first-step'),
 choice('review-agreement','问现在究竟说定了什么','区分已落实、明确拒绝与仍然未知；不会因此触发新的结局。','first-step')
]
knowing={
 '#care-and-contact':{'start':{'knows':['yamagami','mother','uncle']}},
 '#family-accounts':{'start':{'knows':['yamagami','mother','uncle']}},
 '#education-questions':{'start':{'knows':['uncle'],'not':['yamagami','mother']}},
 '#income-and-housing':{'start':{'knows':['uncle'],'not':['yamagami','mother']}},
 '#support-terms':{'start':{'knows':['uncle'],'not':['yamagami','mother']}},
 '#refusal-and-alternatives':{'start':{'knows':['uncle','mother'],'not':['yamagami']}},
 '#study-first-step':{'start':{'knows':['uncle'],'not':['yamagami','mother']}},
 '#independent-first-step':{'start':{'knows':['uncle'],'not':['yamagami','mother']}},
 '#pause-first-step':{'start':{'knows':['uncle'],'not':['yamagami','mother']}},
 '#commitment-ledger':{'start':{'knows':[],'not':['yamagami','mother','uncle']}}
}
scenario={
 'ref':'@djj/yamagami-family-2002','type':'scenario','display_name':'山上徹也：2002，下一步由你决定',
 'summary':'破产之后的一次家庭谈话：核对教育、收入与住处，拒绝或协商亲属条件，把下一步真正留给玩家。',
 'description':'玩家扮演山上徹也。以2002年之前的公开背景为起点，在四个可回访场次中同母亲、伯父协商。私人对白、心理、具体安排与分支全部是明确的叙事模拟；不知道的真实数字不补造，开局后的走向可以改变。作者出处与来源限制见同目录 sources.json、AUTHOR-NOTES.md。',
 'authors':AUTHOR_DEFAULTS['authors'],'fragments':fragments,'references':refs,'cast':cast,'assets':[],
 'groups':[
  {'id':'people','title':'怎样与这两个人谈','description':'母亲与伯父的模拟表达和边界；供叙事者扮演，不把私人动机直接发给玩家。','entries':['mother-voice','uncle-voice']},
  {'id':'practical','title':'把生活的问题问具体','description':'按当前场次和已知信息核对家庭、教育、收入及照料。','entries':['family-accounts','care-and-contact','education-questions','income-and-housing']},
  {'id':'terms','title':'可以答应，也可以拒绝','description':'协商帮助的具体范围，区分提议、拒绝与承诺。','entries':['support-terms','refusal-and-alternatives']},
  {'id':'next-step','title':'只落实眼前一步','description':'已讨论的方向才成为玩家可知的首步资料；记录具体约定。','entries':['study-first-step','independent-first-step','pause-first-step','commitment-ledger']}
 ],
 'story':{'version':1,'player':'yamagami','scenes':scenes,'beats':beats,'choices':choices,'endings':endings,
   'vars':{
    'priority_named':{'type':'bool','init':False,'description':'玩家已明确表达一项当前需要；不是人物好感值。'},
    'facts_checked':{'type':'bool','init':False,'description':'已确认至少一项待核实问题；不表示所有信息都已经查清。'},
    'terms_discussed':{'type':'bool','init':False,'description':'已了解一次协助的范围；不代表接受。'},
    'considered':{'type':'set','init':[],'values':['study','independent','pause'],'description':'已明确研究的方向，可同时包含多种；研究不等于承诺。'},
    'step_prepared':{'type':'bool','init':False,'description':'玩家已把一个首步说具体；还需要独立确认阶段结果。'},
    'outcome':{'type':'enum','init':'undecided','values':['undecided','study','independent','pause'],'description':'本章已确认的阶段里程碑；纠正须通过正式操作，不以旁白悄改。'}
   },'knowing':knowing,
   'plotlines':[{'id':'family-and-choice','title':'把亲属关系与生活决定分开','scenes':[s['id'] for s in scenes],'beats':[b['id'] for b in beats]}],
   'starts':[{'id':'after-bankruptcy','title':'2002 · 破产之后，下一步之前','description':'你还没有答应接下来的安排。先保护什么、先问谁，由你开口。','scene':'family-table','greeting':'2002年，奈良。你是山上徹也。父亲早已去世，母亲的献金与家庭破产已经影响了生活，继续求学和接下来怎样谋生都成了眼前的问题。\n\n【以下私人对白、场景与安排均为模拟；从这里可以改变走向。】\n\n母亲把杯子往你面前推了一点：“你今天回来，是不是已经想好要走了？”\n\n伯父停下翻纸的动作：“先别替他说。徹也，今天你最怕耽误的是什么？”\n\n纸还是空白的。你可以回答，也可以先纠正他们的问法。'}]},
 'meta':copy.deepcopy(AUTHOR_DEFAULTS['meta']),'provenance':{'authored_by_agent':True}
}
scenario['meta']['tags']=['dogfooding','biographical-background','counterfactual','progressive-roleplay','zh-CN']
write_json(HERE/'yamagami-family-2002.json',scenario)
print(json.dumps({'fragments':len(fragments),'semantic':sum(f.get('activation',{}).get('mode')=='semantic' for f in fragments),'scenes':len(scenes),'beats':len(beats),'choices':len(choices),'endings':len(endings),'vars':len(scenario['story']['vars'])}))
