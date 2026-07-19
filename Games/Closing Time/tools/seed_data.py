#!/usr/bin/env python3
"""Seed content generator for Closing Time.
Writes individual JSON files under /data. Run from repo root: python3 tools/seed_data.py
Content authors can also hand-write JSON files directly; this script just batches the initial set.
"""
import json, os, itertools

ROOT = os.path.join(os.path.dirname(__file__), "..", "data")

def write(cat, id_, obj):
    path = os.path.join(ROOT, cat, f"{id_}.json")
    with open(path, "w") as f:
        json.dump(obj, f, indent=2)
    return f"{cat}/{id_}.json"

manifest = {"listings": [], "clients": [], "agents": [], "brokerages": [], "neighborhoods": [], "events": []}

# ---------------- NEIGHBORHOODS ----------------
neighborhoods = [
 dict(id="nb_carver_mill", name="Carver Mill", identity="starter",
      vibe="Postwar brick ranchers and vinyl-sided capes near the old textile mill. Honest houses, honest problems.",
      basePriceIndex=0.78, priceTrend=0.004, trendVolatility=0.006, schoolQuality=2,
      amenities=["mill trail", "corner groceries", "VFW hall"],
      buyerDemand=0.9, knowledgeNotes=["Sewer laterals from the 50s are the silent killer here.",
        "Anything under $200k gets investor offers within a week."]),
 dict(id="nb_maple_terrace", name="Maple Terrace", identity="established",
      vibe="Tree-lined streets, four-square colonials, block parties with a sign-up sheet. Turnover is low and personal.",
      basePriceIndex=1.0, priceTrend=0.002, trendVolatility=0.003, schoolQuality=4,
      amenities=["Maple Terrace Elementary", "farmers market", "pool club with a waitlist"],
      buyerDemand=1.1, knowledgeNotes=["Listings here sell on school-boundary maps, not square footage.",
        "The pool club waitlist transfers with the house. People care. A lot."]),
 dict(id="nb_old_foundry", name="Old Foundry", identity="up-and-coming",
      vibe="Warehouses turning into taprooms, rowhomes half-renovated. Every third house is a flip; some are good.",
      basePriceIndex=0.86, priceTrend=0.011, trendVolatility=0.012, schoolQuality=2,
      amenities=["taproom row", "artist studios", "new bike lanes"],
      buyerDemand=1.15, knowledgeNotes=["Check the permit history on every flip. Every single one.",
        "Prices are climbing but appraisers are six months behind the market."]),
 dict(id="nb_brackenridge", name="Brackenridge Heights", identity="luxury",
      vibe="Stone estates behind old hedges. The HOA newsletter has a masthead. Deals move quietly, through people.",
      basePriceIndex=2.6, priceTrend=0.001, trendVolatility=0.004, schoolQuality=5,
      amenities=["country club", "private lake access", "gated lanes"],
      buyerDemand=0.7, knowledgeNotes=["Luxury buyers don't negotiate price. They negotiate terms and pride.",
        "Homes here sit for months, then sell in a weekend to someone's college roommate."]),
 dict(id="nb_downtown", name="Downtown Alder Falls", identity="urban",
      vibe="Lofts over storefronts, a courthouse clocktower, parking disputes as a way of life.",
      basePriceIndex=1.05, priceTrend=0.005, trendVolatility=0.009, schoolQuality=3,
      amenities=["riverwalk", "restaurants", "commuter rail to the city"],
      buyerDemand=1.0, knowledgeNotes=["Condo docs and HOA reserves matter more than granite counters.",
        "Rail commuters pay a premium for anything within five blocks of the station."]),
 dict(id="nb_lake_petrie", name="Lake Petrie", identity="waterfront-mixed",
      vibe="Cottages that became year-round homes, docks in varying stages of legality, spectacular sunsets.",
      basePriceIndex=1.35, priceTrend=0.006, trendVolatility=0.014, schoolQuality=3,
      amenities=["lake access", "boat launch", "seasonal ice cream stand"],
      buyerDemand=1.05, knowledgeNotes=["Half the docks were never permitted. Ask before your buyer falls in love.",
        "Waterfront appraisals swing wildly — comps are apples to speedboats."]),
]
for nb in neighborhoods:
    manifest["neighborhoods"].append(write("neighborhoods", nb["id"], nb))

# ---------------- BROKERAGES ----------------
brokerages = [
 dict(id="bk_indep", name="Independent (Your Own Shingle)", commissionSplit=1.0,
      reputationRequirement=0, leadFlow=0, perks=[], recruits=False,
      pitch="No split, no support, no safety net. Your name on the sign — and the sign is a lawn sign you bought yourself.",
      personality="none"),
 dict(id="bk_hearthstone", name="Hearthstone Realty", commissionSplit=0.55, reputationRequirement=0,
      leadFlow=2, perks=["1 free lead every Monday", "reputation floor of 10", "office coffee (adequate)"],
      recruits=True, recruitRepThreshold=0, signingBonus=0,
      pitch="Family-run since 1987. We won't make you rich, but we won't let you starve, and Deb at the front desk knows everyone.",
      personality="folksy"),
 dict(id="bk_axiom", name="Axiom Partners", commissionSplit=0.65, reputationRequirement=30,
      leadFlow=3, perks=["mid-market and luxury leads", "in-house marketing team (+1 photo tier free)", "closing coordinator (paperwork actions cost half a slot)"],
      recruits=True, recruitRepThreshold=35, signingBonus=4000,
      pitch="We track numbers you didn't know you had. Hit them and the leads get better. Miss them and we'll talk about your funnel.",
      personality="corporate"),
 dict(id="bk_vanguard", name="Vanguard Estates Group", commissionSplit=0.75, reputationRequirement=60,
      leadFlow=2, perks=["luxury-tier client access", "Brackenridge network invitations", "your face on a bus bench"],
      recruits=True, recruitRepThreshold=65, signingBonus=12000,
      pitch="We don't advertise. We introduce. Bring us a reputation and we'll bring you rooms you couldn't get into alone.",
      personality="exclusive"),
]
for bk in brokerages:
    manifest["brokerages"].append(write("brokerages", bk["id"], bk))

# ---------------- AGENTS (rivals / NPC listing & buyer agents) ----------------
agents = [
 dict(id="ag_sal_dimeo", name="Sal DiMeo", brokerageId="bk_hearthstone", negotiationStyle="lowballer",
      rivalryFlag=True, tolerance=0.06, counterAggression=0.8, dirtyTricks=False,
      bio="Twenty years of opening every negotiation with an insulting number and a shrug. It works more than it should.",
      dialogueHooks=dict(
        greeting=["Sal DiMeo. I'll save us both time — your people are asking too much.",
                  "Kid. Sal DiMeo. Let's talk real numbers, not zillow numbers."],
        counter=["That's cute. Here's what my client will actually pay.",
                 "I've seen this house. I've smelled this house. Adjust accordingly."],
        accept=["Fine. Don't tell anyone I went this high.",
                "Deal. You're less green than you look."],
        reject=["We're done here. Call me when gravity applies to your pricing.",
                "Nope. My guy walks. He's got three other addresses in his pocket."])),
 dict(id="ag_priya_natesan", name="Priya Natesan", brokerageId="bk_axiom", negotiationStyle="by-the-book",
      rivalryFlag=True, tolerance=0.03, counterAggression=0.5, dirtyTricks=False,
      bio="Scrupulously honest, terrifyingly prepared. Brings comps in a binder with tabs. Respects agents who disclose early.",
      dialogueHooks=dict(
        greeting=["Priya Natesan, Axiom. I've pulled six comps and a flood map. Shall we?",
                  "Good to meet you. I assume you've already reviewed the disclosure package. I have. Twice."],
        counter=["Comp-supported counter attached. Page four, highlighted.",
                 "My clients will move exactly as far as the data moves. No further."],
        accept=["Clean numbers, clean deal. My favorite kind. Accepted.",
                "Accepted. And — noted for the record — you disclosed that furnace issue unprompted. I remember things like that."],
        reject=["The numbers don't support it and I won't pretend otherwise. We decline.",
                "Declined. Nothing personal. Everything numerical."])),
 dict(id="ag_chuck_brandt", name="Chuck 'The Handshake' Brandt", brokerageId="bk_hearthstone", negotiationStyle="charmer",
      rivalryFlag=True, tolerance=0.05, counterAggression=0.4, dirtyTricks=True,
      bio="Your first mentor, technically. Now he calls you 'champ' while quietly slipping escalation clauses past you.",
      dialogueHooks=dict(
        greeting=["CHAMP! Look at you, doing deals. Proud of you. Now let's talk about how you're about to overpay.",
                  "Kid! Remember when I taught you the lockbox codes? Good times. Anyway, my sellers are FIRM."],
        counter=["Between us? Take the counter. I'd hate to see you lose this one, champ.",
                 "I'm doing you a favor with this number. Frame it."],
        accept=["Attaboy! See, this is why I taught you everything you know. Not everything I know.",
                "Deal! Drinks on you when you're famous."],
        reject=["Champ. Champ champ champ. No. But hey — great hustle.",
                "It's a no. Someday you'll thank me. Probably not today."])),
 dict(id="ag_marisol_vega", name="Marisol Vega", brokerageId="bk_vanguard", negotiationStyle="stonewall",
      rivalryFlag=True, tolerance=0.02, counterAggression=0.9, dirtyTricks=False,
      bio="Handles half of Brackenridge Heights. Speaks quietly, never twice. Getting a counter from her is a compliment.",
      dialogueHooks=dict(
        greeting=["Marisol Vega. My clients are not in a hurry. Are yours?",
                  "I represent the house you're calling about. The price is the price."],
        counter=["One counter. This is it.",
                 "My clients have authorized exactly one adjustment. Here it is."],
        accept=["Accepted. Congratulations — few people hear me say that.",
                "We have an agreement. My clients expect a flawless close. So do I."],
        reject=["No. The property will still be here. The offer won't need to be.",
                "Declined. Do come back when you're serious."])),
 dict(id="ag_denny_kessler", name="Denny Kessler", brokerageId="bk_axiom", negotiationStyle="shark",
      rivalryFlag=True, tolerance=0.04, counterAggression=0.85, dirtyTricks=True,
      bio="Plays dirty and keeps score. Manufactures competing offers, poaches clients at open houses, smiles constantly.",
      dialogueHooks=dict(
        greeting=["Denny Kessler. Heard good things. Well — heard things.",
                  "Oh, you're the agent on this one? Fun. This'll be fun."],
        counter=["Counter's attached. Also, just so you know, we have another offer. Do we? Wouldn't you like to know.",
                 "Tick tock. My clients have options. Some of them even exist."],
        accept=["Accepted! No hard feelings about the other stuff. There will be other stuff.",
                "Deal. You got lucky. I'll allow it — once."],
        reject=["Pass. And hey — tell your client I'm around if they ever want representation with... reach.",
                "Declined. Watch the deadline on your next one. Deadlines are slippery things."])),
 dict(id="ag_ruth_okafor", name="Ruth Okafor", brokerageId="bk_indep", negotiationStyle="mentor",
      rivalryFlag=False, tolerance=0.05, counterAggression=0.3, dirtyTricks=False,
      bio="Independent, semi-retired, beloved. Sends you clients she doesn't have time for. Expects you to earn it.",
      dialogueHooks=dict(
        greeting=["Ruth Okafor. I've heard about you — mostly good, which at your stage is remarkable.",
                  "Ah, the new one. Let's make this painless. Painless deals are how careers get built."],
        counter=["Here's a fair counter, and a free lesson: never make your first offer your best one.",
                 "Countering — gently. Your client can afford this, and mine deserves it."],
        accept=["Accepted. Handled well. I may send someone your way.",
                "That's a deal. You listened more than you talked. Keep that."],
        reject=["No — and if you think about why, you'll write a better offer next time.",
                "Declined, dear. Sleep on it and call me tomorrow."])),
]
for ag in agents:
    manifest["agents"].append(write("agents", ag["id"], ag))

# ---------------- LISTINGS ----------------
# hiddenIssues: discovery = visible | question:<topic> | inspection ; severity = cosmetic | moderate | dealbreaker
# topics: roof, water, electrical, hvac, foundation, pests, permits, sewer, hoa, neighbors
def issue(desc, discovery, severity, cost, disclosure=False, topic=None):
    o = dict(desc=desc, discovery=discovery, severity=severity, repairCost=cost, disclosureRequired=disclosure)
    if topic: o["topic"] = topic
    return o

L = []
def listing(id, addr, nb, tier, price, beds, baths, sqft, features, issues, agent, dom, blurb, cond=0.7):
    L.append(dict(id=id, address=addr, neighborhood=nb, tier=tier, price=price, beds=beds, baths=baths,
                  sqft=sqft, features=features, hiddenIssues=issues, listingAgentId=agent,
                  daysOnMarket=dom, blurb=blurb, condition=cond))

listing("ls_0001", "114 Spindle St", "nb_carver_mill", "starter", 168000, 3, 1, 1120,
 ["fenced yard","detached garage","new water heater"],
 [issue("Roof shingles curling at the south edge","visible","moderate",6500,topic="roof"),
  issue("Original 1958 sewer lateral, partially root-blocked","inspection","dealbreaker",11000,True,"sewer"),
  issue("Kitchen linoleum peeling in corners","visible","cosmetic",800)],
 "ag_sal_dimeo", 24, "Solid brick rancher one block off the mill trail. Priced for a buyer with a paintbrush and optimism.", 0.55)
listing("ls_0002", "27 Loom Ct", "nb_carver_mill", "starter", 189500, 3, 1.5, 1260,
 ["updated kitchen","covered porch","corner lot"],
 [issue("Basement smells faintly of mildew after rain","question","moderate",4200,True,"water"),
  issue("Two bedroom windows painted shut","visible","cosmetic",400)],
 "ag_ruth_okafor", 11, "Cheerful cape with a kitchen redone in 2022. The porch swing conveys, per the seller, 'obviously.'", 0.7)
listing("ls_0003", "9 Bobbin Aly", "nb_carver_mill", "starter", 142000, 2, 1, 890,
 ["new furnace","walk to mill trail"],
 [issue("Knob-and-tube wiring in the attic circuit","inspection","dealbreaker",9500,True,"electrical"),
  issue("Sloping kitchen floor — joist sistering needed","question","moderate",5200,topic="foundation"),
  issue("Chain-link fence rusted through","visible","cosmetic",900)],
 "ag_sal_dimeo", 61, "Investor special or first-home gamble, depending on your inspector's mood.", 0.4)
listing("ls_0004", "88 Weaver Way", "nb_carver_mill", "starter", 214900, 4, 2, 1540,
 ["primary suite addition","shed","fresh paint"],
 [issue("Addition built without permits in 2019","question","dealbreaker",7000,True,"permits"),
  issue("Gutter downspouts drain toward foundation","visible","moderate",1800,topic="water")],
 "ag_denny_kessler", 8, "Biggest starter in the Mill — the addition makes it. Ask the listing agent anything. He loves questions.", 0.65)
listing("ls_0005", "402 Maple Terrace Dr", "nb_maple_terrace", "mid", 372000, 4, 2.5, 2180,
 ["walk to elementary","finished basement","two-car garage"],
 [issue("HVAC is 22 years old and wheezing","question","moderate",8500,topic="hvac"),
  issue("Hairline settling crack over the garage lintel","visible","cosmetic",600)],
 "ag_priya_natesan", 6, "The school-boundary unicorn. Expect company at the showing.", 0.75)
listing("ls_0006", "17 Orchard Loop", "nb_maple_terrace", "mid", 349900, 3, 2, 1890,
 ["screened porch","mature trees","pool club eligibility"],
 [issue("Roof at end of life — insurer flagged it","inspection","moderate",12000,True,"roof"),
  issue("Backyard oak dropping limbs on the shed","visible","cosmetic",1200)],
 "ag_chuck_brandt", 19, "Charming colonial with pool-club eligibility. Chuck will mention the pool club four times. Minimum.", 0.7)
listing("ls_0007", "230 Fernwell Ave", "nb_maple_terrace", "mid", 415000, 4, 3, 2440,
 ["renovated 2023","home office","EV charger"],
 [issue("Renovation drywall hides older aluminum branch wiring","inspection","dealbreaker",13500,True,"electrical")],
 "ag_denny_kessler", 4, "Turnkey renovation, staged within an inch of its life. Photos almost suspiciously good.", 0.85)
listing("ls_0008", "5 Hollis Green", "nb_maple_terrace", "mid", 329000, 3, 1.5, 1710,
 ["original hardwoods","big lot","walk to market"],
 [issue("Single bathroom on bedroom level — tub drains slow","question","cosmetic",700,topic="water"),
  issue("Estate sale: quirky 1970s wallpaper throughout","visible","cosmetic",2500)],
 "ag_ruth_okafor", 33, "Estate sale, first time on market in 51 years. Bring vision; the wallpaper brings everything else.", 0.6)
listing("ls_0009", "61 Crucible Row", "nb_old_foundry", "starter", 232000, 2, 2, 1180,
 ["exposed brick","rooftop deck","walk to taproom row"],
 [issue("Flip: cabinet doors misaligned, outlets loose","visible","cosmetic",1500),
  issue("No final inspection on the rooftop deck","question","moderate",3800,True,"permits"),
  issue("Party-wall moisture staining behind fresh paint","inspection","moderate",6000,True,"water")],
 "ag_denny_kessler", 15, "Freshly flipped rowhome with a deck made for golden hour. Permit history sold separately. (Joking.) (Ask.)", 0.6)
listing("ls_0010", "74 Crucible Row", "nb_old_foundry", "mid", 289000, 3, 2.5, 1520,
 ["restored facade","new mechanicals","permit binder on counter"],
 [issue("Street parking contested during taproom hours","question","cosmetic",0,topic="neighbors")],
 "ag_priya_natesan", 9, "The rare Foundry flip with a full permit binder. Priya will quiz you on it, affectionately.", 0.85)
listing("ls_0011", "12 Annealing Ln", "nb_old_foundry", "mid", 305000, 3, 2, 1600,
 ["corner unit","garage bay","artist loft ceiling"],
 [issue("Converted garage bay has no heat","visible","moderate",4000,topic="hvac"),
  issue("Old foundry fill soil — radon reading borderline","inspection","moderate",2200,True,"water")],
 "ag_sal_dimeo", 27, "Former workshop conversion with ceilings for days. Sal priced it 'to move,' which for Sal means slowly.", 0.65)
listing("ls_0012", "3 Slag Ct", "nb_old_foundry", "starter", 199000, 2, 1, 940,
 ["gut-renovated bath","new windows"],
 [issue("Rear wall bows outward half an inch","inspection","dealbreaker",16000,True,"foundation"),
  issue("No closets in second bedroom","visible","cosmetic",1200)],
 "ag_chuck_brandt", 42, "Cozy two-bed with a brand-new bath. Chuck calls the rear wall 'character.' Get it inspected.", 0.45)
listing("ls_0013", "1 Hedgerow Ln", "nb_brackenridge", "luxury", 1150000, 5, 4.5, 4800,
 ["stone facade","library","four-car garage","lake rights"],
 [issue("Slate roof: 30 tiles cracked, specialist repair","question","moderate",24000,topic="roof"),
  issue("HOA reviewing lake-rights transfer terms","question","moderate",0,True,"hoa")],
 "ag_marisol_vega", 88, "A Brackenridge estate that has outlived four owners and intends to outlive four more. Shown by appointment and reputation.", 0.8)
listing("ls_0014", "40 Pemberly Chase", "nb_brackenridge", "luxury", 875000, 4, 3.5, 3900,
 ["heated pool","chef's kitchen","gatehouse"],
 [issue("Pool heater original to 2005","question","cosmetic",5500,topic="hvac"),
  issue("Underground oil tank decommissioned but undocumented","inspection","dealbreaker",18000,True,"water")],
 "ag_marisol_vega", 120, "Understated by Brackenridge standards, which still means a gatehouse.", 0.75)
listing("ls_0015", "7 Ashcombe Ct", "nb_brackenridge", "luxury", 690000, 4, 3, 3200,
 ["first-floor primary","garden rooms","club-adjacent"],
 [issue("Dated everything — 1998 called, wants its brass back","visible","cosmetic",45000)],
 "ag_ruth_okafor", 51, "The cheapest way into the Heights. Cosmetically frozen in 1998; structurally excellent.", 0.7)
listing("ls_0016", "Unit 4B, The Granary", "nb_downtown", "starter", 246000, 1, 1, 780,
 ["river view","doorman","two blocks to rail"],
 [issue("HOA reserves underfunded; special assessment likely","question","moderate",6000,True,"hoa"),
  issue("Neighbor's dog audible through east wall","question","cosmetic",0,topic="neighbors")],
 "ag_priya_natesan", 14, "Sunrise over the river from the fourth floor. Read the condo docs — Priya has them tabbed.", 0.8)
listing("ls_0017", "Unit 12A, Courthouse Lofts", "nb_downtown", "mid", 389000, 2, 2, 1350,
 ["clocktower view","parking spot","gym"],
 [issue("Clocktower bells: hourly, 7am–10pm","visible","cosmetic",0),
  issue("In-unit washer drain line recalled model","inspection","moderate",2800,True,"water")],
 "ag_chuck_brandt", 22, "Two-bed loft with a deeded parking spot, which downtown is basically a second bedroom.", 0.8)
listing("ls_0018", "310 Riverwalk Ter", "nb_downtown", "mid", 452000, 3, 2.5, 1780,
 ["townhome","roof terrace","rail commute"],
 [issue("Ground-floor flex room floods in hundred-year storms — two so far this decade","inspection","dealbreaker",14000,True,"water")],
 "ag_denny_kessler", 7, "Riverwalk townhome with a roof terrace. 'Water views,' says the listing. Mm-hm.", 0.75)
listing("ls_0019", "18 Petrie Shore Rd", "nb_lake_petrie", "mid", 498000, 3, 2, 1650,
 ["private dock","lake frontage","stone fireplace"],
 [issue("Dock built 1994, never permitted","question","dealbreaker",9000,True,"permits"),
  issue("Shoreline erosion at the northeast corner","visible","moderate",7500,topic="water")],
 "ag_sal_dimeo", 39, "Year-round lake cottage with a dock of, let's say, informal provenance.", 0.6)
listing("ls_0020", "44 Petrie Shore Rd", "nb_lake_petrie", "luxury", 720000, 4, 3, 2900,
 ["permitted boathouse","wraparound deck","guest suite"],
 [issue("Septic sized for 3 bedrooms, not 4","inspection","moderate",12500,True,"sewer")],
 "ag_marisol_vega", 46, "The lake house people mean when they say 'lake house.' Boathouse permits framed on the wall, which tells you about the neighbors.", 0.8)
listing("ls_0021", "2 Inlet Path", "nb_lake_petrie", "starter", 259000, 2, 1, 980,
 ["seasonal lake view","wood stove","big screened porch"],
 [issue("Crawlspace pests — evidence of raccoon tenancy","question","moderate",3200,True,"pests"),
  issue("Road unplowed by county in winter","question","cosmetic",0,topic="neighbors")],
 "ag_ruth_okafor", 18, "Sweet little cottage two rows back from the water. Winter access is 'an adventure.'", 0.6)
listing("ls_0022", "156 Gantry St", "nb_old_foundry", "mid", 335000, 3, 2.5, 1740,
 ["new construction","warranty","rooftop rough-in"],
 [issue("Builder-grade everything; nail pops appearing","visible","cosmetic",1000),
  issue("Sump pump runs constantly — high water table","question","moderate",5000,True,"water")],
 "ag_priya_natesan", 12, "New construction with a builder warranty. The sump pump has opinions about the water table.", 0.85)
listing("ls_0023", "801 Terrace View Dr", "nb_maple_terrace", "mid", 439000, 5, 3, 2600,
 ["in-law suite","cul-de-sac","solar panels"],
 [issue("Solar lease transfers to buyer — $140/mo, 14 years left","question","moderate",0,True,"hoa"),
  issue("In-law suite kitchenette on shared 15-amp circuit","inspection","moderate",2400,topic="electrical")],
 "ag_chuck_brandt", 16, "Five bedrooms and an in-law suite on the quietest cul-de-sac in the Terrace. Ask about the solar lease. Really.", 0.7)
listing("ls_0024", "23 Founders Gate", "nb_brackenridge", "luxury", 1385000, 6, 5.5, 5600,
 ["ballroom-sized great room","wine cellar","staff apartment","gated"],
 [issue("Wine cellar humidity system failed; mold remediation done 2024","question","moderate",8000,True,"water"),
  issue("Original owner's murals: preservation easement in deed","inspection","dealbreaker",0,True,"permits")],
 "ag_marisol_vega", 203, "The Founders Gate estate. Two hundred days on market because the right buyer hasn't been introduced yet. Marisol is patient.", 0.75)

for l in L:
    manifest["listings"].append(write("listings", l["id"], l))

# ---------------- CLIENTS ----------------
# hiddenPrefs: {desc, type: stretchBudget|secretDealbreaker|secretMustHave|realMotive,
#               revealOn: {trigger: feature|missingFeature|topic|schmooze|issueSeverity, value},
#               data: {...}}  — engine interprets by type
C = []
def client(id, name, ctype, archetype, tier, budget, patience, statedReqs, hiddenPrefs, intro, referredBy=None, sellerListing=None, extra=None):
    o = dict(id=id, name=name, type=ctype, archetype=archetype, tier=tier, budget=budget,
             patience=patience, statedReqs=statedReqs, hiddenPrefs=hiddenPrefs, intro=intro,
             referredBy=referredBy)
    if sellerListing: o["sellerListing"] = sellerListing
    if extra: o.update(extra)
    manifest["clients"].append(write("clients", id, o))

client("cl_0001","Dana & Marcus Webb","buyer","first-timers","starter",195000,7,
 dict(minBeds=3, mustFeatures=["fenced yard"], neighborhoods=["nb_carver_mill"], notes="Firm budget. Dog named Biscuit. Extremely firm budget."),
 [dict(desc="Will stretch to $215k for a garage — Marcus restores bikes and hasn't mentioned it because Dana thinks the hobby is over.",
       type="stretchBudget", revealOn=dict(trigger="feature", value="detached garage"), data=dict(newBudget=215000)),
  dict(desc="Dana's dad had a house with foundation problems; anything foundation-related is an instant walk, no matter how minor.",
       type="secretDealbreaker", revealOn=dict(trigger="topic", value="foundation"), data=dict(topic="foundation"))],
 "First-time buyers, pre-approved, terrified in the normal way. Dana has a spreadsheet. Marcus has opinions he hasn't shared with Dana yet.")
client("cl_0002","Ernest Falk","buyer","downsizer","mid",360000,10,
 dict(minBeds=2, mustFeatures=["first-floor primary"], neighborhoods=["nb_maple_terrace","nb_downtown"], notes="Selling the family colonial. In no hurry, or so he says."),
 [dict(desc="'No hurry' is cover — his knees are shot and stairs are becoming unsafe. A true single-level or elevator building would close him fast.",
       type="realMotive", revealOn=dict(trigger="schmooze", value=1), data=dict(patienceBonus=3, urgentFeatures=["first-floor primary"])),
  dict(desc="Secretly hopes to stay walkable to the Maple Terrace farmers market where he knows everyone.",
       type="secretMustHave", revealOn=dict(trigger="feature", value="walk to market"), data=dict(fitBonus=25))],
 "Retired shop teacher, widower, drives a truck older than you. Says he'll 'know it when he sees it.'")
client("cl_0003","Priyanka & Josh Malhotra-Reed","buyer","growing-family","mid",420000,6,
 dict(minBeds=4, mustFeatures=[], neighborhoods=["nb_maple_terrace"], notes="'Good schools' stated approximately eleven times."),
 [dict(desc="'Good schools' actually means their son is struggling at his current school and they won't admit they need a district change by fall.",
       type="realMotive", revealOn=dict(trigger="schmooze", value=1), data=dict(deadlineDay=45, patiencePenaltyPerWeekAfter=1)),
  dict(desc="Josh works nights — a bedroom away from street noise matters more than he's said.",
       type="secretDealbreaker", revealOn=dict(trigger="topic", value="neighbors"), data=dict(topic="neighbors"))],
 "Dual-income, pre-approved above ask, radiating a very specific urgency they insist isn't there.")
client("cl_0004","Theo Grandy","buyer","investor","starter",210000,5,
 dict(minBeds=2, mustFeatures=[], neighborhoods=["nb_carver_mill","nb_old_foundry"], notes="Cash. Wants 'numbers, not vibes.'"),
 [dict(desc="Tolerates dealbreaker-tier issues if the discount is right — repair costs are just line items to him.",
       type="secretMustHave", revealOn=dict(trigger="issueSeverity", value="dealbreaker"), data=dict(ignoresIssues=True, discountExpected=0.12)),
  dict(desc="Will not buy anything with unresolved permit problems — got burned in a past flip. Permits are the one paperwork he fears.",
       type="secretDealbreaker", revealOn=dict(trigger="topic", value="permits"), data=dict(topic="permits"))],
 "Third-generation landlord, first-generation spreadsheet user. Talks cap rates at you unprompted.")
client("cl_0005","Simone Adjei","buyer","relocator","mid",470000,4,
 dict(minBeds=3, mustFeatures=["rail commute"], neighborhoods=["nb_downtown"], notes="Starts new job downtown in five weeks. Patience is a rumor."),
 [dict(desc="Company relo package will actually cover up to $510k — she's negotiating you like she negotiates everything.",
       type="stretchBudget", revealOn=dict(trigger="schmooze", value=1), data=dict(newBudget=510000)),
  dict(desc="Any flooding history is disqualifying — she left a flooded condo in her last city and won't repeat it.",
       type="secretDealbreaker", revealOn=dict(trigger="topic", value="water"), data=dict(topic="water"))],
 "Hospital administrator relocating for a promotion. Answers emails during showings. Respects competence, notices its absence.")
client("cl_0006","Bev & Lou Castellano","buyer","dreamers","luxury",800000,9,
 dict(minBeds=4, mustFeatures=["lake access"], neighborhoods=["nb_lake_petrie","nb_brackenridge"], notes="Sold a restaurant chain. Want 'the lake house people mean when they say lake house.'"),
 [dict(desc="Lou can't swim. The dock is for show; a great deck and sunset view outrank actual water access.",
       type="secretMustHave", revealOn=dict(trigger="feature", value="wraparound deck"), data=dict(fitBonus=30)),
  dict(desc="Bev will walk from anything with septic problems — she ran restaurants; she knows what that smell costs.",
       type="secretDealbreaker", revealOn=dict(trigger="topic", value="sewer"), data=dict(topic="sewer"))],
 "Cheerfully loaded, gloriously indecisive. Every showing ends with 'we love it!' and no offer. Yet.")
client("cl_0007","Marguerite Ellison-Voss","buyer","luxury","luxury",1400000,8,
 dict(minBeds=5, mustFeatures=[], neighborhoods=["nb_brackenridge"], notes="Referred through 'people.' Interviewing agents, including you, whether you noticed or not."),
 [dict(desc="The interview: she drops small factual errors about properties to see if you correct her. Honesty scores; flattery ends careers.",
       type="realMotive", revealOn=dict(trigger="schmooze", value=2), data=dict(honestyWeight=2.0)),
  dict(desc="Wants the Founders Gate estate specifically but won't say so — mention its history and watch.",
       type="secretMustHave", revealOn=dict(trigger="feature", value="wine cellar"), data=dict(fitBonus=40, targetListing="ls_0024"))],
 "Family money, museum board, terrifying diction. Marisol Vega expects to represent her. That's the game.")
client("cl_0008","Kofi Amankwah","buyer","first-timer","starter",178000,6,
 dict(minBeds=2, mustFeatures=[], neighborhoods=["nb_carver_mill","nb_old_foundry"], notes="Nurse, night shifts. Wants quiet and a short drive to Mercy General."),
 [dict(desc="Sleeps days — noise topics (bells, taprooms, barky dogs) are dealbreakers he's too polite to enforce until it's too late.",
       type="secretDealbreaker", revealOn=dict(trigger="topic", value="neighbors"), data=dict(topic="neighbors")),
  dict(desc="Saving a second down payment to bring his mother over — a legal in-law option or 2nd unit potential is quietly worth everything.",
       type="secretMustHave", revealOn=dict(trigger="schmooze", value=1), data=dict(fitBonus=25))],
 "Kind, exhausted, decisive when it counts. Will trust your word exactly once. Make it count.")
client("cl_0009","The Brandts (no relation, they say)","buyer","skeptics","mid",340000,5,
 dict(minBeds=3, mustFeatures=[], neighborhoods=["nb_maple_terrace","nb_old_foundry"], notes="Burned by an agent before. Fact-check everything. Everything."),
 [dict(desc="If you disclose an issue before they find it, trust (and patience) jumps. If they find one you glossed over, they're gone.",
       type="realMotive", revealOn=dict(trigger="issueSeverity", value="moderate"), data=dict(honestyWeight=2.5)),
  ],
 "A couple who arrive with printouts. They've already seen every listing online, including two that sold last year.")
client("cl_0010","Ambrose Petty","buyer","eccentric","mid",390000,12,
 dict(minBeds=2, mustFeatures=[], neighborhoods=["nb_downtown","nb_old_foundry"], notes="'Something with a story.' Budget flexible. Timeline geological."),
 [dict(desc="Writes ghost stories. Bells, murals, mill history, raccoon tenancy — 'issues' with narrative value ADD fit for him.",
       type="secretMustHave", revealOn=dict(trigger="issueSeverity", value="cosmetic"), data=dict(quirkBonus=True)),
  ],
 "Novelist. Patient as sediment. The rare client who gets happier the weirder the showing goes.")
# Seller clients
client("cl_0101","Nadia Ferreira","seller","relocating-seller","mid",0,7,
 dict(notes="Job transfer in 10 weeks. Wants speed over top dollar, but won't say the floor out loud."),
 [dict(desc="Her real floor is 8% under ask — below that she'd rather rent it out and deal with tenants from another state.",
       type="realMotive", revealOn=dict(trigger="schmooze", value=1), data=dict(floorPct=0.92))],
 "Selling the Fernwell house she renovated herself. Every scratch on those floors has a story and a defensiveness.",
 sellerListing=dict(neighborhood="nb_maple_terrace", tier="mid", baseValue=398000, condition=0.8,
   address="212 Fernwell Ave", beds=4, baths=2.5, sqft=2300,
   features=["renovated kitchen","home office","corner lot"],
   issues=[issue("Deck boards soft at the far corner","visible","moderate",2600,topic="water"),
           issue("Water heater at year 14 of a 12-year life","inspection","moderate",1800,True,"water")]))
client("cl_0102","Gil & Rosa Marchetti","seller","downsizing-sellers","starter",0,10,
 dict(notes="44 years in the house. Emotionally priced. Every offer will feel like an insult at first."),
 [dict(desc="What they actually want is a buyer who'll love the garden — a personal letter or a family buyer is worth $10k of price to them.",
       type="realMotive", revealOn=dict(trigger="schmooze", value=1), data=dict(sentimentDiscount=10000))],
 "Retiring to be near grandkids. Rosa interviews you about your grandmother. Have an answer.",
 sellerListing=dict(neighborhood="nb_carver_mill", tier="starter", baseValue=205000, condition=0.6,
   address="31 Spindle St", beds=3, baths=1.5, sqft=1300,
   features=["legendary garden","covered porch","garage"],
   issues=[issue("Roof at 19 years, one leak patched","question","moderate",7800,True,"roof"),
           issue("Garden shed leans companionably","visible","cosmetic",600),
           issue("Original fuse box, 60-amp service","inspection","dealbreaker",8500,True,"electrical")]))
client("cl_0103","Derrick Ostrowski","seller","impatient-flipper","mid",0,4,
 dict(notes="Flipper carrying two loans. Needs this Foundry flip gone yesterday. Allergic to the word 'inspection.'"),
 [dict(desc="He knows about the moisture issue behind the paint and hasn't disclosed it. Push him to disclose: lose speed, save your license and rep.",
       type="realMotive", revealOn=dict(trigger="topic", value="water"), data=dict(disclosureConflict=True))],
 "Fast-talking, spreadsheet in one hand, phone in the other. Will pressure you to 'keep the listing clean.'",
 sellerListing=dict(neighborhood="nb_old_foundry", tier="mid", baseValue=272000, condition=0.65,
   address="59 Crucible Row", beds=2, baths=2, sqft=1150,
   features=["exposed brick","new kitchen","rooftop rough-in"],
   issues=[issue("Party-wall moisture behind fresh paint","inspection","moderate",6500,True,"water"),
           issue("Cabinet hardware already loosening","visible","cosmetic",500)]))
client("cl_0104","Constance Hale-Whitmore","seller","estate-executor","luxury",0,9,
 dict(notes="Executor for her late aunt's Brackenridge estate. Three siblings, three opinions, one power of attorney: hers."),
 [dict(desc="A sibling keeps threatening to contest any 'lowball' sale — offers above $650k make the family noise vanish; below it, expect delays.",
       type="realMotive", revealOn=dict(trigger="schmooze", value=1), data=dict(familyFloor=650000))],
 "Practical, brisk, quietly grieving. Wants this handled with dignity and preferably before Thanksgiving.",
 sellerListing=dict(neighborhood="nb_brackenridge", tier="luxury", baseValue=705000, condition=0.65,
   address="11 Hedgerow Ln", beds=5, baths=3.5, sqft=3600,
   features=["conservatory","original millwork","club-adjacent"],
   issues=[issue("Conservatory glazing fogged — seals gone","visible","moderate",9000,topic="water"),
           issue("Boiler original to 1987","question","moderate",14000,topic="hvac"),
           issue("Aunt's 40 years of belongings still inside","visible","cosmetic",4000)]))
client("cl_0105","Ray Petrie Jr.","seller","lake-legacy","mid",0,8,
 dict(notes="Yes, THAT Petrie. Selling the last family cottage on the lake his great-grandfather named. The whole shore is watching."),
 [dict(desc="He'll take less from a buyer who won't tear it down — a teardown offer, however rich, triggers a crisis of conscience and a delay.",
       type="realMotive", revealOn=dict(trigger="schmooze", value=1), data=dict(teardownAversion=True))],
 "Affable, guilt-ridden, keeps saying 'it's just a house' in a voice that says it isn't.",
 sellerListing=dict(neighborhood="nb_lake_petrie", tier="mid", baseValue=455000, condition=0.55,
   address="6 Petrie Shore Rd", beds=3, baths=1.5, sqft=1400,
   features=["100ft lake frontage","original stone fireplace","permitted dock"],
   issues=[issue("Foundation piers need re-leveling","inspection","dealbreaker",13000,True,"foundation"),
           issue("Kitchen last updated when Nixon resigned","visible","cosmetic",18000),
           issue("Bats in the boathouse eaves","question","moderate",2000,True,"pests")]))
client("cl_0106","Dr. Yusuf & Amina Okonkwo","seller","upsizers","mid",0,6,
 dict(notes="Selling the downtown loft; twins on the way. Deadline is biological and non-negotiable."),
 [dict(desc="They've already bought in Maple Terrace with a bridge loan — every week unsold costs them real money, more than they've admitted.",
       type="realMotive", revealOn=dict(trigger="schmooze", value=1), data=dict(carryingCostPerWeek=900))],
 "Organized to a fault, nesting at industrial scale. Amina has staged the loft herself. It shows. Beautifully.",
 sellerListing=dict(neighborhood="nb_downtown", tier="mid", baseValue=402000, condition=0.9,
   address="Unit 9C, Courthouse Lofts", beds=2, baths=2, sqft=1400,
   features=["clocktower view","deeded parking","custom built-ins"],
   issues=[issue("Clocktower bells: hourly, 7am–10pm","visible","cosmetic",0)]))

# ---------------- EVENTS ----------------
# trigger: {phase: any|underContract|listingActive|openHouse|weekly, mode: buyer|seller|either,
#           minDay, maxDay, minRep, maxRep, minLevel, chancePerCheck implied by weight}
# effect: handler name + params — handlers implemented once in engine, reusable across event files.
E = [
 dict(id="ev_low_appraisal", name="Low Appraisal", mode="buyer", phase="underContract", weight=14,
      minDay=1, text="The appraisal comes back under contract price. The bank's number is the bank's number.",
      effect=dict(handler="appraisalGap", gapPctMin=0.03, gapPctMax=0.08)),
 dict(id="ev_financing_wobble", name="Financing Wobble", mode="buyer", phase="underContract", weight=10,
      minDay=1, text="Your buyer's lender flags a 'document irregularity.' Everyone stays calm. Loudly.",
      effect=dict(handler="financingWobble", failChance=0.35, delayDays=3)),
 dict(id="ev_inspection_surprise", name="Inspection Surprise", mode="either", phase="underContract", weight=12,
      minDay=1, text="The inspector emerges from the crawlspace holding something and wearing an expression.",
      effect=dict(handler="inspectionSurprise", costMin=1500, costMax=9000)),
 dict(id="ev_competing_offer", name="Competing Offer Surfaces", mode="buyer", phase="offerPending", weight=12,
      minDay=1, text="Another offer lands on the table while yours is out. The listing agent sounds delighted.",
      effect=dict(handler="competingOffer", pressurePct=0.03)),
 dict(id="ev_cold_feet_buyer", name="Buyer Cold Feet", mode="buyer", phase="underContract", weight=8,
      minDay=1, text="Your buyer calls at 9pm 'just to talk.' Nothing good starts that way.",
      effect=dict(handler="coldFeet", walkChance=0.3, schmoozeSaves=True)),
 dict(id="ev_cold_feet_seller", name="Seller Cold Feet", mode="seller", phase="underContract", weight=8,
      minDay=1, text="Your seller 'slept on it' and woke up wanting to un-sell the house.",
      effect=dict(handler="coldFeet", walkChance=0.25, schmoozeSaves=True)),
 dict(id="ev_poach_attempt", name="Poaching Attempt", mode="either", phase="any", weight=8, minDay=10,
      text="Denny Kessler ran into one of your clients at a coffee shop. 'Total coincidence.' He gave them his card and a better story.",
      effect=dict(handler="poachAttempt", agentId="ag_denny_kessler", resistBase=0.5)),
 dict(id="ev_brokerage_recruit_axiom", name="Axiom Comes Calling", mode="either", phase="any", weight=6,
      minDay=15, minRep=35, text="An Axiom Partners recruiter emails: subject line 'Your Numbers (Impressive) (Let's Talk)'.",
      effect=dict(handler="brokerageRecruit", brokerageId="bk_axiom")),
 dict(id="ev_brokerage_recruit_vanguard", name="Vanguard Sends a Card", mode="either", phase="any", weight=4,
      minDay=30, minRep=65, text="A thick cream envelope, hand-addressed. Vanguard Estates Group requests the pleasure of a conversation.",
      effect=dict(handler="brokerageRecruit", brokerageId="bk_vanguard")),
 dict(id="ev_rate_spike", name="Rate Spike", mode="either", phase="weekly", weight=7, minDay=7,
      text="The Fed sneezes; mortgage rates catch a cold. Buyers everywhere recalculate what they can afford.",
      effect=dict(handler="rateShift", deltaMin=0.3, deltaMax=0.6)),
 dict(id="ev_rate_dip", name="Rate Dip", mode="either", phase="weekly", weight=6, minDay=7,
      text="Rates tick down. Your phone remembers how to ring.",
      effect=dict(handler="rateShift", deltaMin=-0.5, deltaMax=-0.2)),
 dict(id="ev_hot_block", name="Block Buzz", mode="either", phase="weekly", weight=6, minDay=7,
      text="A food magazine writes up a neighborhood. Prices there develop opinions of themselves.",
      effect=dict(handler="neighborhoodBuzz", trendBoost=0.006, weeks=4)),
 dict(id="ev_inspector_backlog", name="Inspector Backlog", mode="either", phase="underContract", weight=6, minDay=1,
      text="Every inspector in the county is booked. Your contingency clock, however, is not.",
      effect=dict(handler="deadlineSqueeze", extraDays=3)),
 dict(id="ev_client_life", name="Life Happens", mode="buyer", phase="any", weight=8, minDay=5,
      text="A client's life intervenes — a transfer, a breakup, a surprise third kid. Their timeline just changed.",
      effect=dict(handler="patienceShift", deltaMin=-2, deltaMax=2)),
 dict(id="ev_lowball_walkin", name="Open House Lowballer", mode="seller", phase="openHouse", weight=10, minDay=1,
      text="A visitor corners you by the kitchen island with a verbal offer, cash, 'today only,' well under ask.",
      effect=dict(handler="openHouseLowball", pctOfAskMin=0.82, pctOfAskMax=0.9)),
 dict(id="ev_ruth_referral", name="A Word From Ruth", mode="either", phase="any", weight=5, minDay=12, minRep=20,
      text="Ruth Okafor calls: 'I'm too busy for a lovely couple I met. They're yours if you don't make me regret it.'",
      effect=dict(handler="bonusReferral", sourceName="Ruth Okafor")),
]
for e in E:
    manifest["events"].append(write("events", e["id"], e))

with open(os.path.join(ROOT, "manifest.json"), "w") as f:
    json.dump(manifest, f, indent=2)
print("wrote", sum(len(v) for v in manifest.values()), "content files + manifest")
