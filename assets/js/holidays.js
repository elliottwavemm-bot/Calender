/* วันหยุดและวันสำคัญตามปฏิทินไทย
 *
 * Two kinds of day, and the difference matters:
 *
 *   pub  วันหยุดราชการ — a day off. Printed in red, as Thai calendars do,
 *        and it earns a substitute day when it lands on a weekend.
 *   obs  วันสำคัญ — worth marking, but an ordinary working day.
 *
 * Solar dates are rules and hold for any year. The Buddhist days follow the
 * lunar calendar, move every year, and are fixed by government announcement
 * (ประกาศสำนักนายกรัฐมนตรี / ปฏิทินหลวง) — so they are a table, not a
 * formula. A year missing from that table simply shows no Buddhist days
 * rather than a guess: a calendar with the wrong Makha Bucha on it is worse
 * than one that admits it does not know.
 *
 * To add a year: copy its announced dates into LUNAR below. Nothing else
 * needs touching.
 */
window.INKLING_HOLIDAYS = (function () {
  'use strict';

  /* วันหยุดราชการ ที่ตรงวันเดิมทุกปี */
  var FIXED = [
    [1, 1, 'วันขึ้นปีใหม่'],
    [4, 6, 'วันจักรี'],
    [4, 13, 'วันสงกรานต์'],
    [4, 14, 'วันสงกรานต์'],
    [4, 15, 'วันสงกรานต์'],
    [5, 1, 'วันแรงงานแห่งชาติ'],
    [5, 4, 'วันฉัตรมงคล'],
    [6, 3, 'วันเฉลิมพระชนมพรรษา สมเด็จพระบรมราชินี'],
    [7, 28, 'วันเฉลิมพระชนมพรรษา ร.10'],
    [8, 12, 'วันแม่แห่งชาติ'],
    [10, 13, 'วันนวมินทรมหาราช'],
    [10, 23, 'วันปิยมหาราช'],
    [12, 5, 'วันพ่อแห่งชาติ'],
    [12, 10, 'วันรัฐธรรมนูญ'],
    [12, 31, 'วันสิ้นปี']
  ];

  /* วันสำคัญ ที่ไม่ใช่วันหยุด */
  var OBSERVED = [
    [1, 16, 'วันครู'],
    [2, 14, 'วันวาเลนไทน์'],
    [3, 8, 'วันสตรีสากล'],
    [4, 2, 'วันอนุรักษ์มรดกไทย'],
    [6, 5, 'วันสิ่งแวดล้อมโลก'],
    [9, 28, 'วันพระราชทานธงชาติไทย'],
    [12, 25, 'วันคริสต์มาส']
  ];

  /* วันสำคัญทางพระพุทธศาสนา — ประกาศเป็นรายปี ดูหมายเหตุด้านบน
     makha/visakha/asalha/khao เป็นวันหยุดราชการ ok/loy ไม่ใช่ */
  var LUNAR = {
    2025: { makha: '02-12', visakha: '05-11', asalha: '07-10', khao: '07-11', ok: '10-07', loy: '11-05' },
    2026: { makha: '03-03', visakha: '05-31', asalha: '07-29', khao: '07-30', ok: '10-26', loy: '11-24' }
  };

  var LUNAR_NAMES = {
    makha: 'วันมาฆบูชา',
    visakha: 'วันวิสาขบูชา',
    asalha: 'วันอาสาฬหบูชา',
    khao: 'วันเข้าพรรษา',
    ok: 'วันออกพรรษา',
    loy: 'วันลอยกระทง'
  };
  var LUNAR_PUBLIC = { makha: 1, visakha: 1, asalha: 1, khao: 1 };

  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function keyOf(y, m, d) { return y + '-' + pad(m) + '-' + pad(d); }

  function add(map, k, name, pub) {
    (map[k] = map[k] || []).push({ n: name, pub: !!pub });
  }

  /* วันเด็กแห่งชาติ — เสาร์ที่สองของเดือนมกราคม */
  function childrensDay(year) {
    var first = new Date(year, 0, 1);
    var firstSat = 1 + ((6 - first.getDay()) + 7) % 7;
    return firstSat + 7;
  }

  function build(year) {
    var map = {};
    var i;

    for (i = 0; i < FIXED.length; i++) {
      add(map, keyOf(year, FIXED[i][0], FIXED[i][1]), FIXED[i][2], true);
    }
    for (i = 0; i < OBSERVED.length; i++) {
      add(map, keyOf(year, OBSERVED[i][0], OBSERVED[i][1]), OBSERVED[i][2], false);
    }
    add(map, keyOf(year, 1, childrensDay(year)), 'วันเด็กแห่งชาติ', false);

    var lunar = LUNAR[year];
    if (lunar) {
      for (var slot in lunar) {
        if (!Object.prototype.hasOwnProperty.call(lunar, slot)) continue;
        add(map, year + '-' + lunar[slot], LUNAR_NAMES[slot], !!LUNAR_PUBLIC[slot]);
      }
    }

    /* วันหยุดชดเชย — a public holiday falling on a weekend moves to the next
       working day. The standard rule; the cabinet does occasionally override
       it for a particular year, which is a thing to check, not to model. */
    var subs = [];
    for (var k in map) {
      if (!Object.prototype.hasOwnProperty.call(map, k)) continue;
      if (!map[k].some(function (e) { return e.pub; })) continue;
      var parts = k.split('-');
      var dt = new Date(+parts[0], +parts[1] - 1, +parts[2]);
      if (dt.getDay() !== 0 && dt.getDay() !== 6) continue;

      var name = map[k].filter(function (e) { return e.pub; })[0].n;
      do {
        dt.setDate(dt.getDate() + 1);
      } while (
        dt.getDay() === 0 || dt.getDay() === 6 ||
        (map[keyOf(dt.getFullYear(), dt.getMonth() + 1, dt.getDate())] || [])
          .some(function (e) { return e.pub; })
      );
      subs.push([keyOf(dt.getFullYear(), dt.getMonth() + 1, dt.getDate()), name]);
    }
    for (i = 0; i < subs.length; i++) {
      add(map, subs[i][0], 'ชดเชย' + subs[i][1], true);
    }

    return map;
  }

  var cache = {};

  return {
    /* All marked days in a year, keyed YYYY-MM-DD. */
    forYear: function (year) {
      if (!cache[year]) cache[year] = build(year);
      return cache[year];
    },
    /* Which years carry Buddhist days — the app has nothing to say about
       the rest until their dates are announced. */
    lunarYears: Object.keys(LUNAR).map(Number)
  };
})();
