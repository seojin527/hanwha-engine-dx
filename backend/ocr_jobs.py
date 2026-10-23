"""단일 CPU 작업자 + SQLite 영속 작업 대기열. 웹 요청에서 OCR을 기다리지 않는다."""
import json
import os
import shutil
import subprocess
import threading
import time
from pathlib import Path
from uuid import uuid4

from fastapi import HTTPException
from drawing_library import BASE_DIR, UPLOAD_DIR, database
from ocr_results import drawing_exists, read_ocr_result, save_ocr_result
from ocr_metadata import convert

ROOT = BASE_DIR.parent
JOB_DIR = BASE_DIR / 'storage' / 'ocr_jobs'
ACTIVE = ('queued','running')


def init_jobs():
    JOB_DIR.mkdir(parents=True, exist_ok=True)
    with database() as db:
        db.execute('''CREATE TABLE IF NOT EXISTS ocr_jobs (
            job_id TEXT PRIMARY KEY, drawing_id TEXT NOT NULL REFERENCES drawings(drawing_id),
            status TEXT NOT NULL CHECK(status IN ('queued','running','completed','failed')),
            stage TEXT NOT NULL DEFAULT '', error TEXT NOT NULL DEFAULT '',
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)''')
        db.execute("CREATE UNIQUE INDEX IF NOT EXISTS one_active_ocr_job ON ocr_jobs(drawing_id) WHERE status IN ('queued','running')")


def latest_job(drawing_id):
    with database() as db:
        row=db.execute('SELECT * FROM ocr_jobs WHERE drawing_id=? ORDER BY rowid DESC LIMIT 1',(drawing_id,)).fetchone()
    return dict(row) if row else None


def enqueue(drawing_id):
    drawing=drawing_exists(drawing_id)
    if not (UPLOAD_DIR / drawing['stored_filename']).is_file():raise HTTPException(404,'원본 도면 파일이 없습니다.')
    with database() as db:
        db.execute('BEGIN IMMEDIATE')
        existing=db.execute("SELECT * FROM ocr_jobs WHERE drawing_id=? AND status IN ('queued','running')",(drawing_id,)).fetchone()
        if existing:return dict(existing)
        done=db.execute('SELECT 1 FROM ocr_results WHERE drawing_id=?',(drawing_id,)).fetchone()
        if done:
            return {'drawing_id':drawing_id,'status':'completed','stage':'저장된 결과가 있습니다.','error':''}
        job_id=uuid4().hex
        db.execute("INSERT INTO ocr_jobs(job_id,drawing_id,status,stage) VALUES(?,?,'queued','CPU OCR 대기 중')",(job_id,drawing_id))
        db.execute("UPDATE drawings SET ocr_status='queued' WHERE drawing_id=?",(drawing_id,))
        row=db.execute('SELECT * FROM ocr_jobs WHERE job_id=?',(job_id,)).fetchone()
    return dict(row)


def snapshot(drawing_id):
    result=read_ocr_result(drawing_id)
    job=latest_job(drawing_id)
    if job:
        result['job']=job
        if job['status'] in ACTIVE or result['result'] is None:result['status']=job['status']
    return result


class OcrWorker:
    def __init__(self):
        self.stop_event=threading.Event();self.thread=None;self.process=None;self.lockfile=None

    def start(self):
        init_jobs()
        # Prevent two server processes from running CPU OCR concurrently on the same DB.
        self.lockfile=(JOB_DIR/'worker.lock').open('a+b')
        self.lockfile.seek(0);self.lockfile.write(b'0');self.lockfile.flush();self.lockfile.seek(0)
        try:
            if os.name=='nt':
                import msvcrt
                msvcrt.locking(self.lockfile.fileno(),msvcrt.LK_NBLCK,1)
            else:
                import fcntl
                fcntl.flock(self.lockfile.fileno(),fcntl.LOCK_EX|fcntl.LOCK_NB)
        except (OSError,IOError):
            self.lockfile.close();self.lockfile=None
            raise RuntimeError('다른 OCR 서버가 실행 중입니다. app_auto는 한 프로세스만 실행하세요.')
        with database() as db:
            db.execute("UPDATE ocr_jobs SET status='completed',stage='OCR 결과 저장 완료',error='',updated_at=CURRENT_TIMESTAMP WHERE status='running' AND drawing_id IN (SELECT drawing_id FROM ocr_results)")
            db.execute("UPDATE drawings SET ocr_status='failed' WHERE drawing_id IN (SELECT drawing_id FROM ocr_jobs WHERE status='running') AND drawing_id NOT IN (SELECT drawing_id FROM ocr_results)")
            db.execute("UPDATE ocr_jobs SET status='failed',stage='중단됨',error='서버가 종료되어 작업이 중단됐습니다. OCR 재시도를 눌러주세요.',updated_at=CURRENT_TIMESTAMP WHERE status='running'")
        self.thread=threading.Thread(target=self.loop,name='cpu-ocr-worker',daemon=True);self.thread.start()

    def close(self):
        self.stop_event.set()
        if self.process and self.process.poll() is None:
            self.process.terminate()
        if self.thread:self.thread.join(timeout=15)
        if self.lockfile:self.lockfile.close()

    def update(self,job_id,**fields):
        if not fields:return
        columns=','.join(f'{k}=?' for k in fields)
        with database() as db:
            db.execute(f'UPDATE ocr_jobs SET {columns},updated_at=CURRENT_TIMESTAMP WHERE job_id=?',(*fields.values(),job_id))

    def loop(self):
        while not self.stop_event.is_set():
            with database() as db:
                db.execute('BEGIN IMMEDIATE')
                row=db.execute("SELECT * FROM ocr_jobs WHERE status='queued' ORDER BY rowid LIMIT 1").fetchone()
                if row:
                    db.execute("UPDATE ocr_jobs SET status='running',stage='CPU OCR 시작',updated_at=CURRENT_TIMESTAMP WHERE job_id=?",(row['job_id'],))
                    db.execute("UPDATE drawings SET ocr_status='running' WHERE drawing_id=?",(row['drawing_id'],))
            if row:
                try:self.run(dict(row))
                except Exception as exc:
                    self.update(row['job_id'],status='failed',stage='OCR 실패',error=str(exc)[-2500:])
                    with database() as db:
                        db.execute("UPDATE drawings SET ocr_status='failed' WHERE drawing_id=? AND drawing_id NOT IN (SELECT drawing_id FROM ocr_results)",(row['drawing_id'],))
            else:self.stop_event.wait(0.5)

    def run(self,job):
        drawing=drawing_exists(job['drawing_id'])
        input_path=(UPLOAD_DIR/drawing['stored_filename']).resolve()
        output=JOB_DIR/job['job_id'];output.mkdir(parents=True,exist_ok=True)
        python=Path(os.environ.get('OCR_PYTHON',str(ROOT/'.venv-ocr'/('Scripts/python.exe' if os.name=='nt' else 'bin/python'))))
        runner=ROOT/'edocr2'/'test_drawing_cpu.py'
        if not python.is_file():raise ValueError(f'OCR Python이 없습니다: {python}')
        if not runner.is_file():raise ValueError(f'CPU 실행기가 없습니다: {runner}')
        env=os.environ.copy();env['PYTHONUNBUFFERED']='1';env['PYTHONIOENCODING']='utf-8';env['CUDA_VISIBLE_DEVICES']='-1'
        tessdata=env.get('OCR_TESSDATA')
        if not tessdata:
            local=Path(env.get('LOCALAPPDATA',str(Path.home())))/'Tesseract'/'tessdata'
            if local.is_dir():tessdata=str(local)
        if tessdata:env['TESSDATA_PREFIX']=tessdata
        tesseract=env.get('OCR_TESSERACT') or shutil.which('tesseract')
        default=Path(r'C:\Program Files\Tesseract-OCR\tesseract.exe')
        if not tesseract and default.is_file():tesseract=str(default)
        command=[str(python),str(runner),str(input_path),'--output-dir',str(output)]
        if tesseract:command+=['--tesseract',tesseract]
        poppler=env.get('OCR_POPPLER')
        if not poppler:
            pdfinfo=shutil.which('pdfinfo')
            localapp=Path(env.get('LOCALAPPDATA',str(Path.home())))
            if not pdfinfo:
                link=localapp/'Microsoft'/'WinGet'/'Links'/'pdfinfo.exe'
                if link.is_file():pdfinfo=str(link.resolve())
            if not pdfinfo:
                packages=localapp/'Microsoft'/'WinGet'/'Packages'
                found=list(packages.glob('oschwartz10612.Poppler_*/*/Library/bin/pdfinfo.exe'))
                if found:pdfinfo=str(found[0])
            if pdfinfo:poppler=str(Path(pdfinfo).resolve().parent)
        if poppler:command+=['--poppler',poppler]
        started=time.monotonic()
        # Stream to disk, not PIPE: long prediction logs cannot block a child process.
        log_path=output/'run.log'
        with log_path.open('wb') as log:
            self.process=subprocess.Popen(command,cwd=ROOT,env=env,stdout=log,stderr=subprocess.STDOUT)
            previous=''
            while self.process.poll() is None:
                if self.stop_event.wait(0.5):
                    self.process.terminate();self.process.wait(timeout=10);raise RuntimeError('서버 종료로 OCR이 중단됐습니다.')
                if time.monotonic()-started>3600:
                    self.process.terminate();self.process.wait(timeout=10);raise RuntimeError('OCR 제한 시간(60분)을 초과했습니다.')
                tail=log_path.read_bytes()[-16000:].decode('utf-8',errors='replace')
                stages=[line for line in tail.splitlines() if line.startswith('[STAGE]')]
                if stages and stages[-1]!=previous:
                    previous=stages[-1];self.update(job['job_id'],stage=previous.removeprefix('[STAGE]').strip())
            code=self.process.returncode;self.process=None
        if code:
            tail=log_path.read_bytes()[-4000:].decode('utf-8',errors='replace')
            raise RuntimeError('OCR 실행 실패. 로그: '+str(log_path)+'\n'+tail[-2200:])
        if self.stop_event.is_set():raise RuntimeError('결과 저장 전 작업이 중단됐습니다.')
        self.update(job['job_id'],stage='JSON 변환·좌표 검증 중')
        txt=output/f'{input_path.stem}_origin.txt';jpg=output/f'{input_path.stem}_result.jpg'
        if not txt.is_file() or not jpg.is_file():raise ValueError('OCR JPG/TXT 결과 파일이 생성되지 않았습니다.')
        metadata=convert(txt.read_text(encoding='utf-8-sig'),drawing['drawing_id'],jpg.name)
        metadata['source_filename']=drawing['original_filename']
        (output/'metadata.json').write_text(json.dumps(metadata,ensure_ascii=False,indent=2),encoding='utf-8')
        
        # 실제 OCR 원본을 도면 ID로 검수 API에 연결한다.
        review_origin_dir = ROOT / "data" / "origin"
        review_origin_dir.mkdir(parents=True, exist_ok=True)
        shutil.copy2(txt, review_origin_dir / f"{drawing['drawing_id']}_origin.txt")
        shutil.copy2(jpg, review_origin_dir / f"{drawing['drawing_id']}_result.jpg")

        save_ocr_result(drawing['drawing_id'],metadata,jpg.read_bytes())
        self.update(job['job_id'],status='completed',stage='OCR 결과 저장 완료',error='')
