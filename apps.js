const DAYS_LIST = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
function getWeekDays() {
  const today = new Date();
  const day = today.getDay();
  const diff = today.getDate() - day + (day === 0 ? -6 : 1);
  const mon = new Date(today.setDate(diff));
  return DAYS_LIST.map((dayName, i) => {
    const d = new Date(mon); d.setDate(mon.getDate() + i);
    return { dayName, dateStr: d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) };
  });
}

function App() {
  const [activeTab, setActiveTab] = useState('swipe');
  const [catFilter, setCatFilter] = useState('ALL');
  const [meals, setMeals] = useState(MASTER_RECIPES);
  const [deckIndex, setDeckIndex] = useState(0);

  const [plannedMeals, setPlannedMeals] = useState(() => {
    const saved = localStorage.getItem('basketboss_planned');
    if (saved) { try { return JSON.parse(saved); } catch(e) {} }
    return [
      { meal: MASTER_RECIPES[0], assignedDay: 'Monday' },
      { meal: MASTER_RECIPES[10], assignedDay: 'Wednesday' },
      { meal: MASTER_RECIPES[50], assignedDay: 'Saturday' }
    ];
  });

  const [pantryChecked, setPantryChecked] = useState(() => {
    const saved = localStorage.getItem('basketboss_pantry');
    if (saved) { try { return JSON.parse(saved); } catch(e) {} }
    return {};
  });

  const [scanMessage, setScanMessage] = useState('');
  const [wipeoutMode, setWipeoutMode] = useState(false);
  const [expandedMethodId, setExpandedMethodId] = useState(null);
  const [cookingMeal, setCookingMeal] = useState(null);
  const [currentStepIndex, setCurrentStepIndex] = useState(0);
  const [timerSeconds, setTimerSeconds] = useState(0);
  const [isTimerRunning, setIsTimerRunning] = useState(false);
  const [dragX, setDragX] = useState(0);
  const startXRef = useRef(null);

  useEffect(() => { localStorage.setItem('basketboss_planned', JSON.stringify(plannedMeals)); }, [plannedMeals]);
  useEffect(() => { localStorage.setItem('basketboss_pantry', JSON.stringify(pantryChecked)); }, [pantryChecked]);

  const currentMeal = meals[deckIndex] || meals[0];
  const weekDays = getWeekDays();

  useEffect(() => {
    let interval = null;
    if (isTimerRunning && timerSeconds > 0) interval = setInterval(() => setTimerSeconds(p => p - 1), 1000);
    else if (timerSeconds === 0) setIsTimerRunning(false);
    return () => clearInterval(interval);
  }, [isTimerRunning, timerSeconds]);

  const applyFilter = (key) => {
    setCatFilter(key); setWipeoutMode(false); setDeckIndex(0);
    setMeals(key === 'ALL' ? MASTER_RECIPES : MASTER_RECIPES.filter(m => m.styleKey === key));
  };

  const startCooking = (m) => { setCookingMeal(m); setCurrentStepIndex(0); setTimerSeconds((m.prepTime || 20) * 60); setIsTimerRunning(false); };
  const formatTime = (s) => `${Math.floor(s / 60)}:${s % 60 < 10 ? '0' : ''}${s % 60}`;

  const toggleWipeoutMode = () => {
    if (!wipeoutMode) {
      const f = MASTER_RECIPES.filter(m => m.ingredients.some(ing => pantryChecked[ing.id]));
      if (f.length > 0) { setMeals(f); setDeckIndex(0); setWipeoutMode(true); setScanMessage(`🌪️ Wipeout Active! ${f.length} meals match your fridge.`); }
      else setScanMessage('⚠️ Scan or tick off items in the Shop tab first!');
    } else { applyFilter('ALL'); setScanMessage('Full 60-recipe cookbook restored.'); }
  };

  const basketItems = (() => {
    const map = {};
    plannedMeals.forEach(pm => pm.meal?.ingredients?.forEach(ing => {
      if (!map[ing.id]) map[ing.id] = { ...ing, usedInCount: 1 };
      else map[ing.id].usedInCount += 1;
    }));
    return Object.values(map);
  })();

  const totalBasketCost = basketItems.reduce((s, i) => pantryChecked[i.id] ? s : s + i.price, 0);
  const savedBySharing = basketItems.reduce((s, i) => i.usedInCount > 1 ? s + i.price * (i.usedInCount - 1) : s, 0);
  const categoriesOrder = ['Meat', 'Vegetables', 'Dairy', 'Grains', 'Bakery'];
  const categoryLabels = { Meat: '🥩 Meat & Fish', Vegetables: '🥦 Vegetables & Produce', Dairy: '🥛 Dairy', Grains: '🌾 Grains & Dry Goods', Bakery: '🍞 Bakery' };
  const groupedBasket = basketItems.reduce((acc, i) => { (acc[i.category || 'Grains'] = acc[i.category || 'Grains'] || []).push(i); return acc; }, {});

  const handleDecision = (liked) => {
    if (liked && currentMeal && !plannedMeals.find(pm => pm.meal.id === currentMeal.id)) {
      const used = plannedMeals.map(pm => pm.assignedDay);
      const day = DAYS_LIST.find(d => !used.includes(d)) || 'Sunday';
      setPlannedMeals([...plannedMeals, { meal: currentMeal, assignedDay: day }]);
    }
    setDragX(0); setDeckIndex(p => (p + 1) % meals.length);
  };

  return (
    <div className="max-w-md mx-auto min-h-screen flex flex-col justify-between pb-24 bg-[#14171f]">
      {cookingMeal && (
        <div className="fixed inset-0 z-50 bg-[#0f1319] p-5 flex flex-col justify-between overflow-y-auto">
          <div>
            <div className="flex justify-between items-center mb-4">
              <span className="text-xs font-black uppercase text-emerald-400">👨‍🍳 Kitchen Focus Mode</span>
              <button onClick={() => setCookingMeal(null)} className="bg-slate-800 text-slate-300 px-3.5 py-1.5 rounded-xl font-bold text-xs border border-slate-700">✕ Exit</button>
            </div>
            <h2 className="text-xl font-black text-white mb-4">{cookingMeal.name}</h2>
            <div className="bg-[#1c202a] border border-slate-700 rounded-2xl p-4 mb-6 flex justify-between items-center card-shadow">
              <div>
                <span className="text-[10px] uppercase font-bold text-slate-400 block">Countdown</span>
                <span className="text-3xl font-black text-emerald-300 font-mono">{formatTime(timerSeconds)}</span>
              </div>
              <div className="flex gap-2">
                <button onClick={() => setIsTimerRunning(!isTimerRunning)} className={`px-4 py-2 rounded-xl text-xs font-black uppercase ${isTimerRunning ? 'bg-amber-500 text-slate-950' : 'bg-emerald-500 text-slate-950'}`}>{isTimerRunning ? 'Pause' : 'Start'}</button>
                <button onClick={() => { setIsTimerRunning(false); setTimerSeconds((cookingMeal.prepTime || 20) * 60); }} className="px-3 py-2 bg-slate-800 text-slate-300 rounded-xl text-xs font-bold border border-slate-700">Reset</button>
              </div>
            </div>
            <div className="bg-[#1c202a] border border-slate-700 rounded-3xl p-6 card-shadow space-y-4">
              <span className="text-xs font-black uppercase text-amber-300">Step {currentStepIndex + 1} of {cookingMeal.method.length}</span>
              <p className="text-lg font-bold text-slate-100 leading-relaxed min-h-[120px] pt-2">{cookingMeal.method[currentStepIndex]}</p>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3 mt-6">
            <button disabled={currentStepIndex === 0} onClick={() => setCurrentStepIndex(p => Math.max(0, p - 1))} className="py-4 rounded-2xl bg-slate-800 text-slate-200 font-bold text-xs uppercase border border-slate-700 disabled:opacity-40">← Prev</button>
            <button disabled={currentStepIndex === cookingMeal.method.length - 1} onClick={() => setCurrentStepIndex(p => Math.min(cookingMeal.method.length - 1, p + 1))} className="py-4 rounded-2xl bg-emerald-500 text-slate-950 font-black text-xs uppercase disabled:opacity-40">Next →</button>
          </div>
        </div>
      )}

      <header className="p-4 glass-header sticky top-0 z-20 border-b border-slate-800/80 flex justify-between items-center shadow-lg">
        <div className="flex items-center gap-2.5">
          <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-emerald-500/20 to-rose-500/20 border border-emerald-500/40 flex items-center justify-center shadow-inner">
            <svg className="w-6 h-6 text-emerald-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M2 7l4 3 6-5 6 5 4-3v2H2V7z" fill="currentColor" fillOpacity="0.15" />
              <path d="M3 9h18l-2 11H5L3 9z" />
              <path d="M9 14l3 3 3-3" stroke="#f43f5e" strokeWidth="2" />
            </svg>
          </div>
          <div>
            <h1 className="text-lg font-black tracking-tight text-white leading-none">Basket<span className="text-emerald-400">Boss</span></h1>
            <p className="text-[11px] text-slate-400 font-medium mt-0.5">{wipeoutMode ? '🌪️ Wipeout Mode' : `${meals.length} Cookbook Recipes`}</p>
          </div>
        </div>
        <div className="bg-emerald-500/10 border border-emerald-500/30 px-3.5 py-1.5 rounded-xl text-right">
          <span className="text-[10px] uppercase tracking-wider text-emerald-400 block font-bold">Est. Shop</span>
          <span className="text-lg font-extrabold text-emerald-300">£{totalBasketCost.toFixed(2)}</span>
        </div>
      </header>

      <main className="p-4 flex-1">
        {activeTab === 'swipe' && currentMeal && (
          <div>
            <div className="flex gap-1.5 overflow-x-auto pb-3 mb-1 no-select">
              {[
                { k: 'ALL', l: '📚 All (60)' }, { k: 'FAM', l: '👨‍👩‍👧‍👦 Family (10)' },
                { k: 'OP', l: '🍳 One-Pan (10)' }, { k: 'SC', l: '🍲 Slow Cook (10)' },
                { k: 'FK', l: '🥡 Fakeaway (10)' }, { k: 'HL', l: '🥗 Healthy (10)' },
                { k: 'DN', l: '🥂 Date Night (10)' }
              ].map(t => (
                <button key={t.k} onClick={() => applyFilter(t.k)} className={`px-3 py-1.5 rounded-full text-[11px] font-extrabold whitespace-nowrap border transition ${catFilter === t.k ? 'bg-emerald-500 text-slate-950 border-emerald-400' : 'bg-[#1c202a] text-slate-300 border-slate-700'}`}>
                  {t.l}
                </button>
              ))}
            </div>

            <div
              onTouchStart={e => { startXRef.current = e.touches[0].clientX; }}
              onTouchMove={e => { if (startXRef.current !== null) setDragX(e.touches[0].clientX - startXRef.current); }}
              onTouchEnd={() => { if (dragX > 90) handleDecision(true); else if (dragX < -90) handleDecision(false); else setDragX(0); startXRef.current = null; }}
              style={{ transform: `translateX(${dragX}px) rotate(${dragX * 0.04}deg)`, transition: startXRef.current ? 'none' : 'transform 0.25s ease' }}
              className={`rounded-3xl overflow-hidden card-shadow no-select border transition-all ${currentMeal.isDateNight ? 'bg-gradient-to-b from-[#251522] to-[#1c1f28] border-rose-500/40' : 'bg-[#1c202a] border-slate-700/80'}`}
            >
              <div className="relative h-60">
                <img src={currentMeal.image} alt={currentMeal.name} className="w-full h-full object-cover" />
                <div className="absolute inset-0 bg-gradient-to-t from-[#1c202a] via-transparent to-black/30"></div>
                <div className="absolute top-3 left-3 z-10">
                  <div className={`px-3.5 py-1 rounded-full text-[11px] font-black uppercase tracking-wider border shadow-lg backdrop-blur-md ${currentMeal.styleTagColor}`}>
                    {currentMeal.styleTag}
                  </div>
                </div>
                <div className="absolute bottom-3 left-3 bg-[#14171f]/85 backdrop-blur px-3 py-1 rounded-full text-xs font-bold text-emerald-300 border border-emerald-500/30">
                  £{currentMeal.estCost.toFixed(2)} meal est.
                </div>
                <div className="absolute top-3 right-3 bg-[#14171f]/85 backdrop-blur px-3 py-1 rounded-full text-xs font-bold text-slate-200 border border-slate-700">
                  ⏱ {currentMeal.prepTime} mins
                </div>
              </div>

              <div className="p-5">
                <span className={`text-[11px] font-black uppercase tracking-wider ${currentMeal.isDateNight ? 'text-rose-400' : 'text-emerald-400'}`}>{currentMeal.category}</span>
                <h2 className="text-xl font-bold text-white mt-1 mb-3 leading-snug">{currentMeal.name}</h2>
                <div className={`rounded-2xl p-3.5 mb-5 border ${currentMeal.isDateNight ? 'bg-rose-950/30 border-rose-800/40 text-rose-100' : 'bg-[#14171f]/70 border-slate-700/80 text-slate-200'}`}>
                  <div className="text-xs font-bold text-amber-300 mb-1">{currentMeal.isDateNight ? '🕯️ Date Night Plan' : '👨‍👩‍👧‍👦 Kitchen Time-Saver'}</div>
                  <p className="text-xs leading-relaxed opacity-90">{currentMeal.familyTip}</p>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <button onClick={() => handleDecision(false)} className="py-3.5 rounded-2xl bg-[#14171f] active:scale-95 text-slate-300 font-bold text-xs uppercase border border-slate-700">✕ Discard (No)</button>
                  <button onClick={() => handleDecision(true)} className={`py-3.5 rounded-2xl font-extrabold text-xs uppercase active:scale-95 shadow-lg ${currentMeal.isDateNight ? 'bg-rose-600 text-white' : 'bg-emerald-500 text-slate-950'}`}>✓ Add to Week (Yes)</button>
                </div>
              </div>
            </div>

            <div className="flex flex-col items-center mt-4 px-1">
              <p className="text-[11px] text-slate-400 text-center font-medium bg-[#1c202a] px-4 py-2 rounded-xl border border-slate-800 w-full">
                💡 <span className="text-emerald-400 font-bold">Swipe Right</span> = Add | <span className="text-rose-400 font-bold">Swipe Left</span> = Skip
              </p>
              <p className="text-[10px] text-indigo-400 font-semibold mt-2">📚 Recipe {deckIndex + 1} of {meals.length} (Saved locally on device)</p>
            </div>
          </div>
        )}

        {activeTab === 'scan' && (
          <div className="space-y-4">
            <div className="bg-[#1c202a] border border-slate-700/80 rounded-3xl p-6 text-center card-shadow">
              <div className="text-5xl mb-3">📸</div>
              <h2 className="text-base font-black text-white">AI Fridge & Pantry Scanner</h2>
              <p className="text-xs text-slate-400 mt-1 mb-5">Snap a photo of your fridge to tick off packs you own and filter for Zero-Waste meals.</p>
              <label className="block w-full py-4 px-4 bg-emerald-500 text-slate-950 font-black text-xs uppercase rounded-2xl cursor-pointer shadow-lg mb-3">
                📷 Take or Upload Fridge Photo
                <input type="file" accept="image/*" onChange={() => { setPantryChecked(p => ({ ...p, p1: true, v1: true, d1: true })); setScanMessage('📸 Fridge scanned! Chicken, Peppers & Cheddar ticked off.'); }} className="hidden" />
              </label>
              <button onClick={toggleWipeoutMode} className={`w-full py-3.5 px-4 font-black text-xs uppercase rounded-2xl border ${wipeoutMode ? 'bg-amber-500 text-slate-950 border-amber-400' : 'bg-[#14171f] text-amber-300 border-amber-500/50'}`}>
                🌪️ {wipeoutMode ? 'Disable Pantry Wipeout Mode' : 'Activate Pantry Wipeout Mode'}
              </button>
            </div>
            {scanMessage && <div className="bg-emerald-950/80 border border-emerald-500/50 rounded-2xl p-4 text-xs text-emerald-200 font-bold">✅ {scanMessage}</div>}
          </div>
        )}

        {activeTab === 'shop' && (
          <div className="space-y-5">
            <div className="bg-emerald-950/40 border border-emerald-700/50 rounded-2xl p-4 flex justify-between items-center card-shadow">
              <div>
                <h3 className="text-xs font-black uppercase text-emerald-300">Smart Pack Sharing</h3>
                <p className="text-xs text-slate-300 mt-0.5">Overlapping ingredients combined into single packs</p>
              </div>
              <span className="text-sm font-black text-emerald-300 bg-emerald-900/60 px-3.5 py-1 rounded-xl border border-emerald-600/40">Saved £{savedBySharing.toFixed(2)}</span>
            </div>
            <div>
              <h3 className="text-xs font-black uppercase text-slate-400 mb-2">This Week's Menu ({plannedMeals.length})</h3>
              <div className="space-y-2">
                {plannedMeals.map(pm => (
                  <div key={pm.meal.id} className="flex justify-between items-center bg-[#1c202a] border border-slate-700/80 px-3.5 py-3 rounded-2xl">
                    <div>
                      <span className="text-sm font-bold text-white block">{pm.meal.isDateNight ? '🥂 ' : '🍽️ '}{pm.meal.name}</span>
                      <span className="text-[11px] text-emerald-400 font-semibold">Assigned to: {pm.assignedDay}</span>
                    </div>
                    <button onClick={() => setPlannedMeals(plannedMeals.filter(x => x.meal.id !== pm.meal.id))} className="text-xs text-rose-400 font-bold px-2.5 py-1 rounded-lg bg-rose-500/10 border border-rose-500/20">Remove</button>
                  </div>
                ))}
              </div>
            </div>
            <div className="space-y-4">
              <h3 className="text-xs font-black uppercase text-slate-400">Categorized Shopping List (Tap if in kitchen)</h3>
              {categoriesOrder.map(catKey => {
                const items = groupedBasket[catKey];
                if (!items || !items.length) return null;
                return (
                  <div key={catKey} className="bg-[#1c202a] border border-slate-700/80 rounded-2xl p-3.5 space-y-2">
                    <h4 className="text-xs font-black uppercase text-emerald-400 px-1">{categoryLabels[catKey]}</h4>
                    {items.map(item => (
                      <div key={item.id} onClick={() => setPantryChecked(p => ({ ...p, [item.id]: !p[item.id] }))} className={`p-3 rounded-xl border flex justify-between items-center cursor-pointer ${pantryChecked[item.id] ? 'bg-[#14171f]/50 border-slate-800 opacity-40 line-through' : 'bg-[#14171f] border-slate-700/80'}`}>
                        <div>
                          <span className="text-sm font-semibold text-white">{item.name}</span>
                          {item.usedInCount > 1 && <div className="mt-1"><span className="text-[10px] bg-emerald-500/20 text-emerald-300 px-2 py-0.5 rounded-md font-bold border border-emerald-500/30">Shared across {item.usedInCount} meals</span></div>}
                        </div>
                        <span className="text-sm font-extrabold text-emerald-300">£{item.price.toFixed(2)}</span>
                      </div>
                    ))}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {activeTab === 'calendar' && (
          <div className="space-y-4">
            {weekDays.map(wd => {
              const assigned = plannedMeals.filter(pm => pm.assignedDay === wd.dayName);
              return (
                <div key={wd.dayName} className="rounded-2xl border overflow-hidden bg-[#1c202a] border-slate-700/80">
                  <div className="px-4 py-2.5 bg-[#14171f]/80 border-b border-slate-700/60 flex justify-between items-center">
                    <span className="text-xs font-black uppercase text-white">{wd.dayName} ({wd.dateStr})</span>
                    <span className="text-[10px] font-bold text-slate-400">{assigned.length > 0 ? `${assigned.length} Assigned` : 'Free Night'}</span>
                  </div>
                  <div className="p-3.5 space-y-3">
                    {assigned.length > 0 ? assigned.map(pm => {
                      const meal = pm.meal;
                      const isOpen = expandedMethodId === `${wd.dayName}-${meal.id}`;
                      return (
                        <div key={meal.id} className="p-3.5 rounded-xl border bg-[#14171f] border-slate-700">
                          <div className="flex justify-between items-start mb-2">
                            <div>
                              <span className={`text-[10px] font-extrabold px-2.5 py-0.5 rounded-full uppercase inline-block mb-1 border ${meal.styleTagColor}`}>{meal.styleTag}</span>
                              <h4 className="text-sm font-bold text-white">{meal.name}</h4>
                            </div>
                            <button onClick={() => setPlannedMeals(plannedMeals.filter(x => x.meal.id !== meal.id))} className="text-xs text-rose-400 font-bold px-2 py-1 rounded bg-rose-500/10">✕</button>
                          </div>
                          <div className="flex items-center gap-2 mb-3 bg-[#1c202a] p-2 rounded-xl border border-slate-700">
                            <span className="text-[11px] font-bold text-slate-300">📅 Move Day:</span>
                            <select value={pm.assignedDay} onChange={e => setPlannedMeals(plannedMeals.map(x => x.meal.id === meal.id ? { ...x, assignedDay: e.target.value } : x))} className="w-full bg-[#14171f] text-emerald-300 text-xs font-bold py-1 px-2 rounded-lg border border-slate-600">
                              {DAYS_LIST.map(d => <option key={d} value={d}>{d}</option>)}
                            </select>
                          </div>
                          <button onClick={() => startCooking(meal)} className="w-full py-2.5 bg-emerald-500 text-slate-950 font-black text-xs uppercase rounded-xl mb-2">👨‍🍳 Start Cooking Mode</button>
                          <button onClick={() => setExpandedMethodId(isOpen ? null : `${wd.dayName}-${meal.id}`)} className="w-full py-2 bg-[#1c202a] text-slate-200 text-xs font-bold rounded-xl border border-slate-700">{isOpen ? 'Hide Quick Method ▴' : 'View Quick Method ▾'}</button>
                          {isOpen && <ol className="list-decimal list-inside space-y-1.5 text-xs text-slate-200 mt-3 pt-3 border-t border-slate-700">{meal.method.map((s, idx) => <li key={idx}>{s}</li>)}</ol>}
                        </div>
                      );
                    }) : <p className="text-xs text-slate-500 italic">No meal scheduled.</p>}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </main>

      <nav className="fixed bottom-0 left-0 right-0 max-w-md mx-auto glass-header border-t border-slate-800/80 grid grid-cols-4 p-2 z-20 shadow-2xl">
        <button onClick={() => setActiveTab('swipe')} className={`py-2.5 rounded-xl text-[11px] font-black uppercase ${activeTab === 'swipe' ? 'text-emerald-400 bg-[#14171f] border border-slate-800' : 'text-slate-400'}`}>🔥 Swipe</button>
        <button onClick={() => setActiveTab('scan')} className={`py-2.5 rounded-xl text-[11px] font-black uppercase ${activeTab === 'scan' ? 'text-emerald-400 bg-[#14171f] border border-slate-800' : 'text-slate-400'}`}>📸 Scan</button>
        <button onClick={() => setActiveTab('shop')} className={`py-2.5 rounded-xl text-[11px] font-black uppercase ${activeTab === 'shop' ? 'text-emerald-400 bg-[#14171f] border border-slate-800' : 'text-slate-400'}`}>🛒 Shop</button>
        <button onClick={() => setActiveTab('calendar')} className={`py-2.5 rounded-xl text-[11px] font-black uppercase ${activeTab === 'calendar' ? 'text-emerald-400 bg-[#14171f] border border-slate-800' : 'text-slate-400'}`}>🗓️ Week</button>
      </nav>
    </div>
  }
  ReactDOM.createRoot(document.getElementById('root')).render(<App />);
  </script>
