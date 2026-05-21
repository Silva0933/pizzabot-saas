"""
Inspeciona as ultimas execucoes do workflow de Pagamento (7kSCqNiuuW511XuL)
para descobrir onde esta falhando.
"""
import os, json
import urllib.request, urllib.error

API_KEY = os.environ['N8N_API_KEY']
WF_ID = '7kSCqNiuuW511XuL'
BASE = 'https://n8nai.secretariaai.eu.cc/api/v1'

def get(path):
    req = urllib.request.Request(f'{BASE}{path}', headers={'X-N8N-API-KEY': API_KEY})
    with urllib.request.urlopen(req) as r:
        return json.loads(r.read())

# 1) Mostra resumo do workflow
wf = get(f'/workflows/{WF_ID}')
print(f"Workflow: {wf['name']}  active={wf.get('active')}  nodes={len(wf['nodes'])}")
print()

# 2) Lista execucoes recentes
try:
    execs = get(f'/executions?workflowId={WF_ID}&limit=5&includeData=true')
    print(f"Total executions returned: {len(execs.get('data', []))}")
    print()

    for ex in execs.get('data', []):
        print('=' * 80)
        print(f"  id={ex.get('id')}  status={ex.get('status')}  finished={ex.get('finished')}")
        print(f"  startedAt={ex.get('startedAt')}  stoppedAt={ex.get('stoppedAt')}")
        print(f"  mode={ex.get('mode')}")

        # Tenta achar erro
        data = ex.get('data', {})
        result_data = data.get('resultData', {})
        if result_data.get('error'):
            err = result_data['error']
            print(f"\n  ERROR: {err.get('message','?')}")
            print(f"  node: {err.get('node',{}).get('name','?')}")
            print(f"  description: {err.get('description','')[:400]}")

        # Mostra ultimo node executado
        run_data = result_data.get('runData', {})
        if run_data:
            print(f"\n  nodes executed:")
            for node_name, runs in run_data.items():
                if runs and len(runs) > 0:
                    last = runs[-1]
                    status = 'ERROR' if last.get('error') else 'ok'
                    print(f"    [{status}] {node_name}")
                    if last.get('error'):
                        e = last['error']
                        print(f"      → {e.get('message','?')[:300]}")
                        if e.get('description'):
                            print(f"      description: {e['description'][:300]}")
                    else:
                        # Mostra primeiro item de output (resumido)
                        outputs = last.get('data', {}).get('main', [[]])
                        if outputs and outputs[0]:
                            sample = outputs[0][0].get('json', {}) if outputs[0] else {}
                            sample_str = json.dumps(sample, ensure_ascii=False)[:200]
                            print(f"      out: {sample_str}")
        print()
except urllib.error.HTTPError as e:
    print(f'HTTP {e.code}: {e.read().decode()[:600]}')
