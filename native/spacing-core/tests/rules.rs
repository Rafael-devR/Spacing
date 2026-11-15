//! Paridade das regras do jogo com o TS (docs/design/PORTE_RUST.md, M4): repete os roteiros de `native/golden/rules.json`
//! (gravados por tools/golden/rules.test.ts) e confere, operação por operação, o que ela devolveu, o estado depois dela e
//! os eventos publicados.
use serde_json::{json, Value};
use spacing_core::blocks::{BlockId, LAVA};
use spacing_core::noise::Mulberry32;
use spacing_core::rules::crafting::{Crafting, CraftingSave, JobView};
use spacing_core::rules::data::Output;
use spacing_core::rules::equipment::Equipment;
use spacing_core::rules::greenhouse::{anchor_at, BlockBox, Greenhouse, GroundView, SpotCheck};
use spacing_core::rules::inventory::Inventory;
use spacing_core::rules::power::{Load, PanelSpot, Power, PowerWorld};
use spacing_core::rules::survival::{SuitInput, Survival};
use spacing_core::rules::{Counts, Events, ItemId, RecipeId, StationId};

fn golden() -> Value {
    let path = concat!(env!("CARGO_MANIFEST_DIR"), "/../golden/rules.json");
    serde_json::from_str(&std::fs::read_to_string(path).expect("rode npm run golden")).expect("json")
}

/// compara JSON com folga nos números (as contas em ponto flutuante são as mesmas, mas a ordem de uma soma pode mudar o
/// último bit)
fn same(a: &Value, b: &Value, path: &str) -> Result<(), String> {
    match (a, b) {
        (Value::Number(x), Value::Number(y)) => {
            let (x, y) = (x.as_f64().unwrap(), y.as_f64().unwrap());
            if (x - y).abs() <= 1e-9 * x.abs().max(y.abs()).max(1.0) {
                Ok(())
            } else {
                Err(format!("{path}: {x} ≠ {y}"))
            }
        }
        (Value::Array(x), Value::Array(y)) => {
            if x.len() != y.len() {
                return Err(format!("{path}: tamanho {} ≠ {}\n  rust: {a}\n  ts:   {b}", x.len(), y.len()));
            }
            x.iter().zip(y).enumerate().try_for_each(|(i, (p, q))| same(p, q, &format!("{path}[{i}]")))
        }
        (Value::Object(x), Value::Object(y)) => {
            let mut keys: Vec<_> = x.keys().chain(y.keys()).collect();
            keys.sort();
            keys.dedup();
            for k in keys {
                match (x.get(k), y.get(k)) {
                    (Some(p), Some(q)) => same(p, q, &format!("{path}.{k}"))?,
                    _ => return Err(format!("{path}.{k}: só de um lado\n  rust: {a}\n  ts:   {b}")),
                }
            }
            Ok(())
        }
        _ if a == b => Ok(()),
        _ => Err(format!("{path}: {a} ≠ {b}")),
    }
}

fn events_json(ev: &Events) -> Value {
    Value::Array(ev.iter().map(|e| {
        let (n, p) = e.to_ts();
        json!([n, p])
    }).collect())
}

/// confere um passo do roteiro
fn check(name: &str, i: usize, f: &Value, ret: Value, state: Value, ev: &Events) {
    let r = same(&ret, &f["ret"], "ret")
        .and_then(|_| same(&state, &f["state"], "estado"))
        .and_then(|_| same(&events_json(ev), &f["events"], "eventos"));
    if let Err(e) = r {
        panic!("{name}, passo {i} ({}): {e}", f["op"]);
    }
}

fn item(v: &Value) -> ItemId {
    ItemId::of(v.as_str().unwrap())
}

fn station(v: &Value) -> StationId {
    StationId::of(v.as_str().unwrap())
}

fn u(v: &Value) -> u32 {
    v.as_f64().unwrap() as u32
}

fn i(v: &Value) -> i64 {
    v.as_f64().unwrap() as i64
}

fn f(v: &Value) -> f64 {
    v.as_f64().unwrap()
}

fn entries(c: &Counts) -> Value {
    Value::Array(c.iter().map(|(k, n)| json!([k.key(), n])).collect())
}

#[test]
fn inventario_igual_ao_ts() {
    let g = golden();
    let mut inv = Inventory::new();
    for (k, fr) in g["inventory"]["frames"].as_array().unwrap().iter().enumerate() {
        let o = &fr["op"];
        let mut ev = Events::new();
        let ret = match o["op"].as_str().unwrap() {
            "add" => json!(inv.add(item(&o["item"]), u(&o["n"]), o["collected"].as_bool().unwrap(), &mut ev)),
            "remove" => json!(inv.remove(item(&o["item"]), u(&o["n"]), &mut ev)),
            "removeSelected" => json!(inv.remove_selected(u(&o["n"]), &mut ev)),
            "removeAll" => {
                let needs: Vec<(ItemId, u32)> = o["needs"].as_array().unwrap().iter().map(|p| (item(&p[0]), u(&p[1]))).collect();
                json!(inv.remove_all(&needs, &mut ev))
            }
            "moveN" => json!(inv.move_n(i(&o["from"]), i(&o["to"]), i(&o["n"]), &mut ev)),
            "move" => {
                inv.move_slot(i(&o["from"]), i(&o["to"]), &mut ev);
                Value::Null
            }
            "quickMove" => json!(inv.quick_move(i(&o["from"]), &mut ev)),
            "sortBag" => {
                inv.sort_bag(&mut ev);
                Value::Null
            }
            "select" => {
                inv.select(i(&o["index"]), &mut ev);
                Value::Null
            }
            "takeEverything" => entries(&inv.take_everything(&mut ev)),
            x => panic!("operação {x}"),
        };
        check("inventário", k, fr, ret, serde_json::to_value(inv.serialize()).unwrap(), &ev);
    }
}

fn view_json(v: &Option<JobView>) -> Value {
    let Some(v) = v else { return Value::Null };
    json!({
        "station": v.station.key(), "slot": v.slot, "recipe": v.recipe.key(), "batch": v.batch, "progress": v.progress,
        "units": v.units, "unitProgress": v.unit_progress, "remaining": if v.remaining.is_finite() { v.remaining } else { -1.0 },
        "ready": v.ready, "paused": v.paused, "step": v.step, "share": v.share, "waiting": entries(&v.waiting),
        "waitingCount": v.waiting_count, "leftover": v.leftover,
    })
}

#[test]
fn fabricacao_igual_ao_ts() {
    let g = golden();
    let gc = &g["crafting"];
    let mut ev = Events::new();
    let mut inv = Inventory::new();
    for p in gc["start"].as_array().unwrap() {
        inv.add(item(&p[0]), u(&p[1]), false, &mut ev);
    }
    let mut eq = Equipment::new();
    let mut rng = Mulberry32::new(99);
    let mut c = Crafting::new();
    let mut speed = [1.0f64; 3];
    for (k, fr) in gc["frames"].as_array().unwrap().iter().enumerate() {
        let o = &fr["op"];
        let mut ev = Events::new();
        let ret = match o["op"].as_str().unwrap() {
            "start" => {
                let id = RecipeId::of(o["recipe"].as_str().unwrap());
                let b = u(&o["batch"]);
                let ch = c.check(id, b, &inv, &eq);
                let check = json!({
                    "ok": ch.ok, "owned": ch.owned, "full": ch.full, "locked": ch.locked, "pending": ch.pending, "max": ch.max,
                    "missing": ch.missing.iter().map(|(i, n)| json!({ "item": i.key(), "missing": n })).collect::<Vec<_>>(),
                });
                let ok = c.start(id, b, &mut inv, &eq, &mut || rng.next_f64(), &mut ev);
                json!({ "check": check, "ok": ok })
            }
            "update" => {
                for (s, v) in speed.iter_mut().zip(o["speed"].as_array().unwrap()) {
                    *s = f(v);
                }
                let sp = speed;
                c.update(f(&o["dt"]), &|s: StationId| sp[s.0 as usize], &mut ev);
                Value::Null
            }
            "take" => {
                let slot = o["slot"].as_f64().map(|s| s as usize);
                match c.take(station(&o["station"]), slot, &mut inv, &mut eq, &mut ev) {
                    Some(t) => json!({
                        "items": entries(&t.items),
                        "delivered": t.delivered.iter().map(|d: &Output| serde_json::to_value(d).unwrap()).collect::<Vec<_>>(),
                        "partial": t.partial,
                        "recipes": t.recipes.iter().map(|r| r.key()).collect::<Vec<_>>(),
                    }),
                    None => Value::Null,
                }
            }
            "cancel" => c.cancel(station(&o["station"]), u(&o["slot"]) as usize, &mut inv, &mut ev).map_or(Value::Null, |b| entries(&b)),
            "togglePause" => json!(c.toggle_pause(station(&o["station"]), u(&o["slot"]) as usize, &mut ev)),
            "give" => json!(inv.add(item(&o["item"]), u(&o["n"]), false, &mut ev)),
            "unlock" => {
                c.unlock(station(&o["station"]));
                Value::Null
            }
            "reload" => {
                let s: CraftingSave = serde_json::from_value(serde_json::to_value(c.serialize()).unwrap()).unwrap();
                c = Crafting::from_save(&s);
                Value::Null
            }
            x => panic!("operação {x}"),
        };
        let sp = speed;
        let spf = move |s: StationId| sp[s.0 as usize];
        let views: Vec<Value> = StationId::all().map(|s| Value::Array(c.slots(s, &spf).iter().map(view_json).collect())).collect();
        let busy: Vec<Value> = StationId::all().map(|s| json!([c.busy(s), c.working(s), c.has_ready(s)])).collect();
        let state = json!({
            "crafting": serde_json::to_value(c.serialize()).unwrap(),
            "inventory": serde_json::to_value(inv.serialize()).unwrap(),
            "equipment": eq.serialize(),
            "views": views,
            "busy": busy,
        });
        check("fabricação", k, fr, ret, state, &ev);
    }
}

#[test]
fn sobrevivencia_igual_ao_ts() {
    let g = golden();
    let gs = &g["survival"];
    let st = &gs["start"];
    let save = spacing_core::rules::survival::SurvivalSave {
        suit: "emergency".into(),
        o2: f(&st["o2"]),
        battery: f(&st["battery"]),
        integrity: f(&st["integrity"]),
        energy: Some(f(&st["energy"])),
    };
    let fall = spacing_core::planet::planet(spacing_core::planet::PlanetId::Lua).physics.fall_safe_speed;
    let mut s = Survival::new(fall, Some(&save));
    let pc = gs["pressure"].as_array().unwrap();
    let pressure = [f(&pc[0]), f(&pc[1]), f(&pc[2])];
    let frames = gs["frames"].as_array().unwrap();
    // o TS começa com a primeira operação como "a de agora" (a posição sai dela até chegar um passo)
    let pos_of = |o: &Value| o["pos"].as_array().map(|p| [f(&p[0]), f(&p[1]), f(&p[2])]);
    let mut pos = pos_of(&frames[0]["op"]).unwrap_or([0.0, 22.0, 0.0]);
    for (k, fr) in frames.iter().enumerate() {
        let o = &fr["op"];
        let mut ev = Events::new();
        let ret = match o["op"].as_str().unwrap() {
            "step" => {
                pos = pos_of(o).unwrap();
                let sheltered = o["sheltered"].as_bool().unwrap();
                let input = SuitInput {
                    pos,
                    moving: o["moving"].as_bool().unwrap(),
                    mining: o["mining"].as_bool().unwrap(),
                    pressure_center: pressure,
                    sheltered,
                    drill_drain: f(&o["drillDrain"]),
                    base_charge: f(&o["baseCharge"]),
                };
                s.step(f(&o["dt"]), &input, &mut ev);
                Value::Null
            }
            "meteor" => {
                s.on_meteor(f(&o["distance"]), o["sheltered"].as_bool().unwrap(), pos, &mut ev);
                Value::Null
            }
            "land" => {
                s.on_land(f(&o["speed"]), pos, &mut ev);
                Value::Null
            }
            "eat" => json!(s.eat(item(&o["item"]))),
            "rest" => {
                s.rest(&mut ev);
                Value::Null
            }
            "respawn" => {
                s.respawn(&mut ev);
                Value::Null
            }
            "damage" => {
                s.damage(f(&o["amount"]), spacing_core::rules::events::DeathCause::Meteor, o["continuous"].as_bool().unwrap(), pos, &mut ev);
                Value::Null
            }
            x => panic!("operação {x}"),
        };
        let mut state = serde_json::to_value(s.serialize()).unwrap();
        let m = state.as_object_mut().unwrap();
        m.insert("dead".into(), json!(s.dead));
        m.insert("invulnerable".into(), json!(s.invulnerable));
        m.insert("inPressure".into(), json!(s.in_pressure));
        m.insert("starving".into(), json!(s.starving));
        m.insert("drillRate".into(), json!(s.drill_rate()));
        // o roteiro do TS publica a queda do meteoro e o pouso no barramento; aqui eles são chamadas diretas
        let mut fr = fr.clone();
        if let Some(list) = fr["events"].as_array_mut() {
            list.retain(|e| !matches!(e[0].as_str(), Some("meteor:impact" | "player:land")));
        }
        check("sobrevivência", k, &fr, ret, state, &ev);
    }
}

/// o mundo de mentira da energia: o que a operação de agora diz
struct OpWorld<'a>(&'a Value);

impl PowerWorld for OpWorld<'_> {
    fn panels(&self) -> Vec<PanelSpot> {
        self.0["panels"].as_array().unwrap().iter().map(|p| PanelSpot { key: p["key"].as_str().unwrap().into(), x: i(&p["x"]) as i32, z: i(&p["z"]) as i32 }).collect()
    }
    fn exposure(&self, x: i32, z: i32) -> Option<f64> {
        let k = self.0["panels"].as_array().unwrap().iter().position(|p| i(&p["x"]) as i32 == x && i(&p["z"]) as i32 == z)?;
        self.0["exposure"][k].as_f64()
    }
    fn loads(&self) -> Vec<Load> {
        self.0["loads"].as_array().unwrap().iter().map(|l| Load { id: l["id"].as_str().unwrap().into(), kw: f(&l["kw"]) }).collect()
    }
    fn dust(&self) -> f64 {
        f(&self.0["dust"])
    }
}

#[test]
fn energia_igual_ao_ts() {
    let g = golden();
    for run in g["power"].as_array().unwrap() {
        let frames = run["frames"].as_array().unwrap();
        let b = run["base"].as_array().unwrap();
        let mut p = Power::new((f(&b[0]), f(&b[1])), f(&run["solar"]), f(&run["shade"]), Some(f(&run["battery"])), &OpWorld(&frames[0]["op"]));
        for (k, fr) in frames.iter().enumerate() {
            let o = &fr["op"];
            p.update(f(&o["dt"]), &OpWorld(o));
            let panels: Vec<Value> = p
                .panels
                .iter()
                .map(|q| json!({ "key": q.key, "x": q.x, "z": q.z, "linked": q.linked, "light": q.light, "kw": q.kw }))
                .collect();
            let state = json!({
                "battery": p.battery, "generation": p.generation, "demand": p.demand, "satisfaction": p.satisfaction,
                "sun": p.sun, "panels": panels, "save": { "battery": p.serialize() },
            });
            check(&format!("energia ({})", run["planet"]), k, fr, Value::Null, state, &Events::new());
        }
    }
}

/// o mesmo chão de mentira de tools/golden/rules.test.ts
struct FakeGround;

impl GroundView for FakeGround {
    fn top_y(&self, x: i32, z: i32) -> i32 {
        20 + ((((x * 3 + z * 5) % 4) + 4) % 4 == 0) as i32 + if x > 40 { 3 } else { 0 }
    }
    fn block(&self, x: i32, _y: i32, z: i32) -> BlockId {
        if x == 30 && z > 0 {
            LAVA
        } else {
            1
        }
    }
}

fn spot_json(c: &SpotCheck) -> Value {
    let mut v = json!({ "ok": c.ok, "floorY": c.floor_y, "x": c.x, "z": c.z });
    if let Some(r) = c.reason {
        v["reason"] = json!(r.key());
    }
    v
}

#[test]
fn estufa_igual_ao_ts() {
    let g = golden();
    let gg = &g["greenhouse"];
    let base: BlockBox = serde_json::from_value(gg["base"].clone()).unwrap();
    let mut ev = Events::new();
    let mut inv = Inventory::new();
    inv.add(ItemId::of("regolith"), 64 * 25, false, &mut ev);
    let mut gh = Greenhouse::new();
    for (k, fr) in gg["frames"].as_array().unwrap().iter().enumerate() {
        let o = &fr["op"];
        let mut ev = Events::new();
        let at = |o: &Value| (f(&o["at"][0]), f(&o["at"][1]));
        let ret = match o["op"].as_str().unwrap() {
            "openChest" => match gh.open_chest(&mut inv, &mut ev) {
                Ok(lots) => json!({ "ok": true, "lots": lots }),
                Err(reason) => {
                    if reason == "full" {
                        inv.remove(ItemId::of("regolith"), 64 * 4, &mut ev);
                    }
                    json!({ "ok": false, "reason": reason })
                }
            },
            "check" => {
                let (tx, tz) = at(o);
                let (x, z) = anchor_at(tx as i32, tz as i32);
                let pl = o["player"].as_array().map(|p| (f(&p[0]), f(&p[1])));
                spot_json(&gh.check(&FakeGround, o["base"].as_bool().unwrap().then_some(base), x, z, pl))
            }
            "place" => {
                let (tx, tz) = at(o);
                let (x, z) = anchor_at(tx as i32, tz as i32);
                let c = gh.check(&FakeGround, Some(base), x, z, None);
                if c.ok {
                    gh.place_site(c.x, c.z, c.floor_y);
                }
                spot_json(&c)
            }
            "deliver" => match gh.deliver(&mut inv, &mut ev) {
                Ok(part) => json!({ "ok": true, "part": part }),
                Err(m) => json!({ "ok": false, "missing": entries(&m) }),
            },
            "finish" => json!(gh.finish()),
            "placeBed" => match gh.site.as_ref().map(|s| (s.x, s.z)) {
                Some((sx, sz)) => {
                    let (dx, dz) = at(o);
                    let (x, z) = (sx + dx as i32, sz + dz as i32);
                    let spot = gh.bed_spot(x, z);
                    json!({ "spot": spot, "ok": gh.place_bed(x, z) })
                }
                None => Value::Null,
            },
            "useBed" => match gh.site.as_ref().map(|s| (s.x, s.z)) {
                Some((sx, sz)) => {
                    let (dx, dz) = at(o);
                    match gh.bed_near(sx as f64 + dx, sz as f64 + dz) {
                        Some(b) => {
                            let bed = gh.bed(b);
                            let pos = json!([bed.x, bed.z]);
                            let action = gh.bed_action(b, &inv).key();
                            let used = match gh.use_bed(b, &mut inv, &mut ev) {
                                Some((a, Some(h))) => json!({ "action": a.key(), "harvested": h }),
                                Some((a, None)) => json!({ "action": a.key() }),
                                None => Value::Null,
                            };
                            json!({ "bed": pos, "action": action, "used": used })
                        }
                        None => Value::Null,
                    }
                }
                None => Value::Null,
            },
            "step" => {
                let ch = gh.step(f(&o["dt"]), f(&o["light"]));
                Value::Array(ch.iter().map(|&b| json!([gh.bed(b).x, gh.bed(b).z])).collect())
            }
            "give" => json!(inv.add(item(&o["item"]), u(&o["n"]), false, &mut ev)),
            "drop" => json!(inv.remove(item(&o["item"]), u(&o["n"]), &mut ev)),
            x => panic!("operação {x}"),
        };
        let next = gh.next_part().map(|i| spacing_core::rules::rules().greenhouse.parts[i].id.clone());
        let state = json!({
            "save": serde_json::to_value(gh.serialize()).unwrap(),
            "inventory": serde_json::to_value(inv.serialize()).unwrap(),
            "next": next,
            "spent": entries(&gh.spent()),
            "missing": entries(&gh.missing(&inv)),
        });
        // a estufa do TS roda sem barramento: só o estado conta
        let fr2 = {
            let mut x = fr.clone();
            x["events"] = events_json(&ev);
            x
        };
        check("estufa", k, &fr2, ret, state, &ev);
    }
}
