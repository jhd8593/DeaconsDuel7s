# Tournament Template Compliance Analysis

## Overview
This document analyzes the differences between your Excel template (`tournament_autopopulate_template.xlsx`) and the current implementation to ensure proper integration.

---

## 📊 Excel Template Structure

### **Teams Sheet**
**Format:**
```
Team          | Pool
------------- | ----
Thunderbolts  | A
Lightning     | A
Storm         | A
Hurricanes    | B
...
```

**Key Points:**
- Simple two-column format
- Team name in column A, Pool assignment in column B
- 14 teams total (3 in Pool A, 3 in Pool B, 4 in Pool C, 4 in Pool D)

---

### **Schedule Sheet**
**Columns:**
```
A: Time
B: Field 1 Team 1
C: Field 1 Score
D: Field 1 Team 2
E: Field 2 Team 1
F: Field 2 Score
G: Field 2 Team 2
H-K: Formula-calculated individual scores (F1 S1, F1 S2, F2 S1, F2 S2)
```

**Key Points:**
- Score format: "15-8" (single string in columns C and F)
- Formulas in columns H-K parse scores using: `IF($C2="","",IFERROR(VALUE(TRIM(INDEX(SPLIT($C2,"-"),1,1))),""))`
- Pre-populated formulas extend to row 200
- Empty rows for future matches

---

### **Standings Sheet**
**Columns:**
```
A: Team
B: Pool (formula: VLOOKUP from Teams sheet)
C: Wins (formula: SUMPRODUCT counting wins from Schedule)
D: PF - Points For (formula: SUMIF from Schedule)
E: PA - Points Against (formula: SUMIF from Schedule)
F: PD - Point Differential (formula: =D2-E2)
G: (spacer)
H-K: Sorted pool rankings (formulas using SORT/FILTER)
```

**Key Formulas:**
- **Pool Lookup:** `VLOOKUP($A2,Teams!$A$2:$B$100,2,FALSE)`
- **Wins:** Complex SUMPRODUCT formula checking all 4 field positions
- **Points For:** `SUMIF(Schedule!$B$2:$B$200,$A2,Schedule!$H$2:$H$200)+...` (sums all 4 positions)
- **Sorted Rankings:** `SORT(FILTER($A$2:$A,$B$2:$B="C"), FILTER($C$2:$C,$B$2:$B="C"), FALSE, ...)`

---

### **Bracket Sheet**
**Structure:**
```
Quarterfinals (rows 2-5):
  - Team references from Standings sorted columns
  - Example: =Standings!L2 (Pool C #1)

Semifinals (rows 8-9):
  - Winner formulas: IF(C2>D2,A2,B2)

Final (row 11):
  - Winner of SF1 vs Winner of SF2

Consolation Elite (rows 14-15):
  - Losers from quarterfinals

Consolation Development (rows 18-20):
  - 2nd vs 2nd, 3rd vs 3rd, 4th vs 4th from Pools C and D
```

---

## 🔍 Current Implementation Analysis

### ✅ **What's Working Correctly**

1. **Score Parsing**
   - `parseScore()` function correctly handles "15-8" format
   - Matches template expectation

2. **Standings Calculation Logic**
   - Wins, PF, PA, PD calculations match template formulas
   - Sorting by wins → PD → PF is correct

3. **Schedule Column Reading**
   - Reading columns B-G (indices 1-6) matches template
   - Field 1: columns B, C, D
   - Field 2: columns E, F, G

4. **Bracket Generation from Standings**
   - Quarterfinal seeding matches template logic
   - Development consolation uses correct pool rankings

### ⚠️ **Gaps & Mismatches**

#### **1. Teams Sheet Parsing (CRITICAL)**

**Template Format:**
```
Team      | Pool
--------- | ----
Eagles    | C
Falcons   | C
```

**Current Code Expects:**
```
Elite Division
  Pool A
    Team1
    Team2
  Pool B
    Team3
```

**Issue:** The `parseTeamsFromTeamsSheet()` function looks for "Elite Division" and "Development Division" headers, but the template just has Team/Pool columns.

**Impact:** Teams won't be parsed correctly from the template.

**Fix Needed:** Update parsing to read simple two-column format.

---

#### **2. Bracket Sheet Reading**

**Template:** Bracket sheet contains formulas that reference Standings, not actual team names initially.

**Current Code:** Tries to read bracket data directly from Bracket sheet.

**Issue:** If sheet has formulas like `=Standings!L2`, the API will return the evaluated result, which should work. However, relying solely on computed standings is more robust.

**Recommendation:** Primary source should be standings calculation; use Bracket sheet only for match scores.

---

#### **3. Schedule Row Header Detection**

**Template:** First row has headers: "Time", "Field 1 Team 1", etc.

**Current Code:** Skips rows where `time.toLowerCase() === 'time'`

**Status:** ✅ Correct

---

#### **4. Pool vs Division Terminology**

**Template:** Uses "Pool A, B, C, D" consistently

**Current Implementation:** 
- Frontend uses "Elite Division (Pools A, B)" and "Development Division (Pools C, D)"
- Server uses poolA, poolB, poolC, poolD

**Status:** ✅ Acceptable - internal terminology doesn't need to match template exactly

---

## 🔧 Required Changes

### **Priority 1: Fix Teams Sheet Parser**

**Current Function:**
```javascript
function parseTeamsFromTeamsSheet(rows) {
  // Expects nested structure with Division headers
  let currentDivision = '';
  let currentPool = '';
  // ...
}
```

**Required Update:**
```javascript
function parseTeamsFromTeamsSheet(rows) {
  const pools = {
    poolA: [],
    poolB: [],
    poolC: [],
    poolD: [],
  };

  rows.forEach((row, idx) => {
    if (idx === 0) return; // skip header
    
    const team = safeStr(row[0]);
    const pool = safeStr(row[1]);
    
    if (!team || !pool) return;
    
    if (pool === 'A') pools.poolA.push(team);
    else if (pool === 'B') pools.poolB.push(team);
    else if (pool === 'C') pools.poolC.push(team);
    else if (pool === 'D') pools.poolD.push(team);
  });

  // Build reverse map
  const teamToPool = {};
  Object.entries(pools).forEach(([poolKey, teams]) => {
    teams.forEach((t) => {
      teamToPool[t] = poolKey;
    });
  });

  return { pools, teamToPool };
}
```

---

### **Priority 2: Verify Column Indices**

The template's Schedule sheet has columns:
- **A (0):** Time
- **B (1):** Field 1 Team 1
- **C (2):** Field 1 Score  
- **D (3):** Field 1 Team 2
- **E (4):** Field 2 Team 1
- **F (5):** Field 2 Score
- **G (6):** Field 2 Team 2

**Current Code:**
```javascript
const f1t1 = safeStr(row[1]); // ✅ Column B
const f1s = safeStr(row[2]);  // ✅ Column C
const f1t2 = safeStr(row[3]); // ✅ Column D
const f2t1 = safeStr(row[4]); // ✅ Column E
const f2s = safeStr(row[5]);  // ✅ Column F
const f2t2 = safeStr(row[6]); // ✅ Column G
```

**Status:** ✅ Already Correct

---

### **Priority 3: Handle Empty Schedule Rows**

**Template:** Has rows with formulas but no data (empty time cells)

**Current Code:** Skips rows where `!time`

**Status:** ✅ Already handled correctly

---

## 📋 Implementation Checklist

- [ ] Update `parseTeamsFromTeamsSheet()` to handle two-column Team/Pool format
- [ ] Test with actual template data
- [ ] Verify standings calculations with template formulas
- [ ] Confirm bracket seeding matches template logic
- [ ] Test score parsing with "15-8" format
- [ ] Verify all pool rankings (C, D, A, B) sort correctly
- [ ] Test empty/incomplete schedule rows
- [ ] Validate development consolation match generation

---

## 🎯 Key Recommendations

1. **Use Template as Source of Truth:** The Excel template's structure should dictate your parsing logic

2. **Rely on Computed Standings:** Don't depend on Bracket sheet formulas - compute seeding from standings in your server

3. **Support Multiple Sheet Versions:** Consider supporting both the old nested format and new simple format for backward compatibility

4. **Add Validation:** Validate that pools have expected team counts (3, 3, 4, 4)

5. **Error Handling:** Gracefully handle missing teams, invalid pool assignments

---

## 📝 Data Flow Summary

```
Teams Sheet (Team/Pool)
    ↓
Parse into pools (A, B, C, D)
    ↓
Schedule Sheet (Time, Teams, Scores)
    ↓
Calculate Standings (Wins, PF, PA, PD)
    ↓
Rank within each pool
    ↓
Seed Championship Bracket
    ↓
Read/Update match scores
    ↓
Display in frontend
```

---

## ✨ Template Formula Examples

**For Reference - Your Server Replicates These:**

### Standings Wins Formula:
```excel
=SUMPRODUCT((Schedule!$B$2:$B$200=$A2)*(Schedule!$H$2:$H$200>Schedule!$I$2:$I$200))
 +SUMPRODUCT((Schedule!$D$2:$D$200=$A2)*(Schedule!$I$2:$I$200>Schedule!$H$2:$H$200))
 +SUMPRODUCT((Schedule!$E$2:$E$200=$A2)*(Schedule!$J$2:$J$200>Schedule!$K$2:$K$200))
 +SUMPRODUCT((Schedule!$G$2:$G$200=$A2)*(Schedule!$K$2:$K$200>Schedule!$J$2:$J$200))
```

### Pool Ranking (sorted):
```excel
=SORT(
  FILTER($A$2:$A,$B$2:$B="C"),
  FILTER($C$2:$C,$B$2:$B="C"), FALSE,
  FILTER($F$2:$F,$B$2:$B="C"), FALSE,
  FILTER($D$2:$D,$B$2:$B="C"), FALSE
)
```

### Bracket Winner:
```excel
=IF(OR(C2="",D2="",AND(C2=0,D2=0)),"Winner QF1",IF(C2>D2,A2,IF(D2>C2,B2,"TIE")))
```

---

## 🚀 Next Steps

1. Apply the **Priority 1** fix to Teams sheet parser
2. Test with your actual Google Sheet using the template format
3. Verify all data flows correctly through the system
4. Update frontend if needed to display new data structure
5. Document any deviations from template for future reference

---

*Last Updated: December 31, 2024*
