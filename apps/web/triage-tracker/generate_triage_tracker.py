#!/usr/bin/env python3
"""
Daily Unassigned To-Do Triage Tracker generator.

What it does, each run:
  1. Reads the newest Azure DevOps work-item CSV export(s) from ./exports
     (any .csv whose header contains the standard work-item columns).
  2. Filters to OPEN + UNASSIGNED items (State in New/Active/Needs Review/
     Pull Request and no Assigned To).
  3. Auto-derives Area / Bucket / Priority / Next action for any NEW item.
  4. Carries forward your manual triage edits (Area, Bucket, Priority,
     Suggested owner, Status, Next action) for items that already exist in the
     previous tracker, so a daily rebuild never wipes your work.
  5. Writes Unassigned_ToDo_Triage_Tracker.xlsx (Dashboard + Tracker sheets).

Dependencies: openpyxl only.  Drop a fresh export in ./exports and re-run.
"""
import csv, glob, json, os, re, sys, html
from datetime import date
from openpyxl import Workbook, load_workbook
from openpyxl.styles import Font, PatternFill, Alignment, Border, Side
from openpyxl.worksheet.datavalidation import DataValidation
from openpyxl.formatting.rule import CellIsRule
from openpyxl.utils import get_column_letter

HERE = os.path.dirname(os.path.abspath(__file__))
EXPORTS = os.path.join(HERE, "exports")
OUTPUT = os.path.join(HERE, "Unassigned_ToDo_Triage_Tracker.xlsx")

REQUIRED_COLS = {"ID", "Work Item Type", "Title", "Assigned To", "State"}
OPEN_STATES = {"New", "Active", "Needs Review", "Pull Request"}

# ---------- 1. load source exports ----------
def load_rows():
    files = sorted(glob.glob(os.path.join(EXPORTS, "*.csv")), key=os.path.getmtime)
    if not files:
        sys.exit(f"No CSV exports found in {EXPORTS}. Drop a work-item export there and re-run.")
    merged = {}
    for f in files:  # newest last -> newest wins on duplicate IDs
        with open(f, newline="", encoding="utf-8-sig") as fh:
            rd = csv.DictReader(fh)
            if not REQUIRED_COLS.issubset(set(rd.fieldnames or [])):
                continue
            for r in rd:
                merged[str(r["ID"]).strip()] = r
    return list(merged.values())

def clean(x):
    if not x:
        return ""
    x = re.sub(r"<[^>]+>", " ", x)
    x = html.unescape(x)
    return re.sub(r"\s+", " ", x).strip()

# ---------- 3. heuristics for new items ----------
def derive_area(title, desc, tags):
    s = f"{title} {desc} {tags}".lower()
    if re.search(r"supportis", s):                                   return "Supportis"
    if re.search(r"\bfli\b|claim|bordereaux|scheme", s):            return "Claims (FLI)"
    if re.search(r"cirrus|invoic", s):                              return "Invoicing (Cirrus)"
    if re.search(r"dual ?drive|quote|quoting|application summary", s): return "Quoting (Dual Drive)"
    if re.search(r"payment|financer|finance instruction|direct debit|\bipt\b|agreement", s): return "Finance / Payments"
    if re.search(r"crm|contact|compan|address|activity", s):        return "CRM"
    if re.search(r"auth|null reference|exception|mail|http|connection|reference exception", s): return "Platform / Infra"
    return "Other"

def derive_bucket(desc, tags):
    d = desc.strip().lower(); t = tags.lower()
    if not d or d == "needs more details":                         return "Flesh out"
    if "flesh out" in t or "not specced" in t:                     return "Flesh out"
    cues = ["needs discussion", "dont code", "don't code", "await", "wish list",
            "no longer needs", "investigation", "reverse eng", "make the call"]
    if any(c in d for c in cues):                                   return "Decision"
    return "Ready to assign"

def derive_priority(wtype, state, desc):
    if state == "Active" or not desc.strip():                       return "High"
    return "Medium"

def derive_action(bucket, desc):
    if bucket == "Flesh out":
        return "Empty/thin body — apply ticket template + acceptance criteria." if not desc.strip() \
               else "Add acceptance criteria and affected-areas note, then assign."
    if bucket == "Decision":
        return "Put on an agenda; make the call, then spec or close."
    return "Specced — assign to the area owner this week."

# ---------- 4. carry forward prior edits ----------
CARRY = ["Area", "Bucket", "Priority", "Suggested owner", "Status", "Next action"]
def load_previous():
    if not os.path.exists(OUTPUT):
        return {}
    wb = load_workbook(OUTPUT)
    if "Tracker" not in wb.sheetnames:
        return {}
    ws = wb["Tracker"]
    hdr = [c.value for c in ws[1]]
    idx = {h: i for i, h in enumerate(hdr) if h}
    prev = {}
    for row in ws.iter_rows(min_row=2, values_only=True):
        if not row or not row[idx["ID"]]:
            continue
        prev[str(row[idx["ID"]]).strip()] = {k: row[idx[k]] for k in CARRY if k in idx}
    return prev

# ---------- styling ----------
BLUE="2E5C8A"; DARK="1F3F5E"; LIGHT="D5E8F0"; GREY="F2F2F2"
AMBER="FCE9D2"; GREEN="D9EAD3"; RED="F4CCCC"; YELLOW="FFF2CC"
thin=Side(style="thin",color="CCCCCC"); border=Border(thin,thin,thin,thin)
hdr_font=Font(name="Arial",bold=True,color="FFFFFF",size=10)
cell_font=Font(name="Arial",size=10)
wrap=Alignment(wrap_text=True,vertical="top")
centerw=Alignment(horizontal="center",vertical="top",wrap_text=True)
center=Alignment(horizontal="center",vertical="center")

def build(items):
    wb=Workbook()
    # Dashboard
    dash=wb.active; dash.title="Dashboard"; dash.sheet_view.showGridLines=False
    dash["B2"]="Unassigned To-Do Triage — Daily"
    dash["B2"].font=Font(name="Arial",bold=True,size=16,color=BLUE)
    dash["B3"]=f"Open, unassigned work items. Auto-generated {date.today().isoformat()}."
    dash["B3"].font=Font(name="Arial",italic=True,size=10,color="666666")
    def kpi(cell,label,formula,fill):
        r=int(cell[1:]); c=cell[0]
        dash[cell]=label; dash[cell].font=Font(name="Arial",bold=True,size=9,color=DARK); dash[cell].alignment=Alignment(horizontal="center")
        v=f"{c}{r+1}"; dash[v]=formula; dash[v].font=Font(name="Arial",bold=True,size=22,color=BLUE); dash[v].alignment=Alignment(horizontal="center")
        for rr in (r,r+1): dash[f"{c}{rr}"].fill=PatternFill("solid",fgColor=fill); dash[f"{c}{rr}"].border=border
    kpi("B5","TOTAL ITEMS",'=COUNTA(Tracker!A2:A1000)',LIGHT)
    kpi("D5","READY TO ASSIGN",'=COUNTIF(Tracker!F2:F1000,"Ready to assign")',GREEN)
    kpi("F5","NEED FLESH OUT",'=COUNTIF(Tracker!F2:F1000,"Flesh out")',AMBER)
    kpi("H5","NEED DECISION",'=COUNTIF(Tracker!F2:F1000,"Decision")',RED)
    dash["B9"]="By bucket"; dash["B9"].font=Font(name="Arial",bold=True,size=12,color=DARK)
    for i,h in enumerate(["Bucket","Count","What to do"]):
        c=dash.cell(row=10,column=2+i,value=h); c.font=hdr_font; c.fill=PatternFill("solid",fgColor=BLUE); c.border=border; c.alignment=center
    for i,(b,f,act,fl) in enumerate([
        ("Ready to assign",'=COUNTIF(Tracker!F2:F1000,"Ready to assign")',"Assign to an area owner this week.",GREEN),
        ("Flesh out",'=COUNTIF(Tracker!F2:F1000,"Flesh out")',"Apply the ticket template + acceptance criteria.",AMBER),
        ("Decision",'=COUNTIF(Tracker!F2:F1000,"Decision")',"Put on an agenda; make the call, then spec/close.",RED)]):
        r=11+i
        x=dash.cell(row=r,column=2,value=b); x.fill=PatternFill("solid",fgColor=fl); x.font=Font(name="Arial",bold=True,size=10)
        y=dash.cell(row=r,column=3,value=f); y.alignment=center; y.font=cell_font
        z=dash.cell(row=r,column=4,value=act); z.font=cell_font
        for col in (2,3,4): dash.cell(row=r,column=col).border=border
    dash["B16"]="By area"; dash["B16"].font=Font(name="Arial",bold=True,size=12,color=DARK)
    for i,h in enumerate(["Area","Count"]):
        c=dash.cell(row=17,column=2+i,value=h); c.font=hdr_font; c.fill=PatternFill("solid",fgColor=BLUE); c.border=border; c.alignment=center
    for i,a in enumerate(["Claims (FLI)","Invoicing (Cirrus)","Finance / Payments","CRM","Supportis","Quoting (Dual Drive)","Platform / Infra","Other"]):
        r=18+i
        dash.cell(row=r,column=2,value=a).font=cell_font
        cc=dash.cell(row=r,column=3,value=f'=COUNTIF(Tracker!E2:E1000,"{a}")'); cc.alignment=center; cc.font=cell_font
        for col in (2,3): dash.cell(row=r,column=col).border=border
    for col,w in {"A":2,"B":24,"C":10,"D":14,"E":10,"F":18,"G":10,"H":16}.items():
        dash.column_dimensions[col].width=w
    # Tracker
    tr=wb.create_sheet("Tracker"); tr.sheet_view.showGridLines=False
    headers=["ID","Type","State","Title","Area","Bucket","Priority","Suggested owner","Status","Next action","Tags","Description"]
    widths=[7,11,13,38,20,16,10,18,13,42,20,46]
    for i,h in enumerate(headers):
        c=tr.cell(row=1,column=i+1,value=h); c.font=hdr_font; c.fill=PatternFill("solid",fgColor=BLUE); c.border=border
        c.alignment=Alignment(horizontal="center",vertical="center",wrap_text=True); tr.column_dimensions[get_column_letter(i+1)].width=widths[i]
    for ri,it in enumerate(items):
        r=ri+2
        vals=[it["ID"],it["Type"],it["State"],it["Title"],it["Area"],it["Bucket"],it["Priority"],it["Owner"],it["Status"],it["Action"],it["Tags"],it["Desc"]]
        for ci,val in enumerate(vals):
            c=tr.cell(row=r,column=ci+1,value=val); c.font=cell_font; c.border=border
            c.alignment=centerw if ci in (0,1,2,5,6,8) else wrap
        tr.row_dimensions[r].height=42
    tr.freeze_panes="A2"; tr.auto_filter.ref=f"A1:L{len(items)+1}"
    n=len(items)+1
    def dv(formula,col):
        d=DataValidation(type="list",formula1=formula,allow_blank=True); tr.add_data_validation(d); d.add(f"{col}2:{col}{n}")
    dv('"Ready to assign,Flesh out,Decision"',"F")
    dv('"High,Medium,Low"',"G")
    dv('"Not started,In progress,Specced,Assigned,Done"',"I")
    dv('"TBD,Cameron Robson-Leigh,Jack Woodhouse,Danny Chen,Adrian Calvert,Louis Thorne,Brendan Thomas"',"H")
    rng=f"F2:F{n}"
    tr.conditional_formatting.add(rng,CellIsRule(operator="equal",formula=['"Ready to assign"'],fill=PatternFill("solid",fgColor=GREEN)))
    tr.conditional_formatting.add(rng,CellIsRule(operator="equal",formula=['"Flesh out"'],fill=PatternFill("solid",fgColor=AMBER)))
    tr.conditional_formatting.add(rng,CellIsRule(operator="equal",formula=['"Decision"'],fill=PatternFill("solid",fgColor=RED)))
    prng=f"G2:G{n}"
    tr.conditional_formatting.add(prng,CellIsRule(operator="equal",formula=['"High"'],fill=PatternFill("solid",fgColor=RED)))
    tr.conditional_formatting.add(prng,CellIsRule(operator="equal",formula=['"Medium"'],fill=PatternFill("solid",fgColor=YELLOW)))
    tr.conditional_formatting.add(f"I2:I{n}",CellIsRule(operator="equal",formula=['"Done"'],fill=PatternFill("solid",fgColor=GREEN)))
    wb.save(OUTPUT)
    tracker_json = os.path.join(HERE, "tracker-data.json")
    with open(tracker_json, "w", encoding="utf-8") as f:
        json.dump([{"id": it["ID"], "area": it["Area"], "bucket": it["Bucket"],
                    "priority": it["Priority"], "suggestedOwner": it["Owner"],
                    "status": it["Status"], "nextAction": it["Action"]} for it in items], f, indent=2)

def main():
    raw = load_rows()
    prev = load_previous()
    items=[]
    for r in raw:
        assignee=(r.get("Assigned To") or "").strip()
        state=(r.get("State") or "").strip()
        if assignee or state not in OPEN_STATES:
            continue
        wid=str(r["ID"]).strip()
        title=(r.get("Title") or "").strip()
        tags=(r.get("Tags") or "").strip()
        desc=clean(r.get("Description") or "") or clean(r.get("Repro Steps") or "")
        p=prev.get(wid,{})
        area=p.get("Area") or derive_area(title,desc,tags)
        bucket=p.get("Bucket") or derive_bucket(desc,tags)
        prio=p.get("Priority") or derive_priority(r.get("Work Item Type",""),state,desc)
        owner=p.get("Suggested owner") or "TBD"
        status=p.get("Status") or "Not started"
        action=p.get("Next action") or derive_action(bucket,desc)
        items.append(dict(ID=wid,Type=(r.get("Work Item Type") or ""),State=state,Title=title,
                          Area=area,Bucket=bucket,Priority=prio,Owner=owner,Status=status,
                          Action=action,Tags=tags or "",Desc=(desc or "(no description — needs detail)")[:300]))
    order={"High":0,"Medium":1,"Low":2}
    items.sort(key=lambda x:(order.get(x["Priority"],3), x["Area"]))
    build(items)
    ready=sum(1 for i in items if i["Bucket"]=="Ready to assign")
    flesh=sum(1 for i in items if i["Bucket"]=="Flesh out")
    dec=sum(1 for i in items if i["Bucket"]=="Decision")
    print(f"OK: {len(items)} open unassigned | {ready} ready, {flesh} flesh-out, {dec} decision -> {OUTPUT}")

if __name__=="__main__":
    main()
