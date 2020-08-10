/* Generated by Opal 1.0.3 */
(function(Opal) {
  function $rb_ge(lhs, rhs) {
    return (typeof(lhs) === 'number' && typeof(rhs) === 'number') ? lhs >= rhs : lhs['$>='](rhs);
  }
  function $rb_le(lhs, rhs) {
    return (typeof(lhs) === 'number' && typeof(rhs) === 'number') ? lhs <= rhs : lhs['$<='](rhs);
  }
  function $rb_divide(lhs, rhs) {
    return (typeof(lhs) === 'number' && typeof(rhs) === 'number') ? lhs / rhs : lhs['$/'](rhs);
  }
  function $rb_minus(lhs, rhs) {
    return (typeof(lhs) === 'number' && typeof(rhs) === 'number') ? lhs - rhs : lhs['$-'](rhs);
  }
  function $rb_times(lhs, rhs) {
    return (typeof(lhs) === 'number' && typeof(rhs) === 'number') ? lhs * rhs : lhs['$*'](rhs);
  }
  function $rb_plus(lhs, rhs) {
    return (typeof(lhs) === 'number' && typeof(rhs) === 'number') ? lhs + rhs : lhs['$+'](rhs);
  }
  var self = Opal.top, $nesting = [], nil = Opal.nil, $$$ = Opal.const_get_qualified, $$ = Opal.const_get_relative, $breaker = Opal.breaker, $slice = Opal.slice, $klass = Opal.klass, $truthy = Opal.truthy;

  Opal.add_stubs(['$==', '$>=', '$<=', '$floor', '$/', '$-', '$*', '$+']);
  return (function($base, $super, $parent_nesting) {
    var self = $klass($base, $super, 'Gundog');

    var $nesting = [self].concat($parent_nesting), $Gundog_check_1D100$1, $Gundog_isD9$2;

    
    Opal.const_set($nesting[0], 'ID', "Gundog");
    Opal.const_set($nesting[0], 'NAME', "ガンドッグ");
    Opal.const_set($nesting[0], 'SORT_KEY', "かんとつく");
    Opal.const_set($nesting[0], 'HELP_MESSAGE', "" + "失敗、成功、クリティカル、ファンブルとロールの達成値の自動判定を行います。\n" + "nD9ロールも対応。\n");
    
    Opal.def(self, '$check_1D100', $Gundog_check_1D100$1 = function $$check_1D100(total, _dice_total, cmp_op, target) {
      var self = this, dig10 = nil, dig1 = nil;

      
      if (target['$==']("?")) {
        return ""};
      if (cmp_op['$==']("<=")) {
      } else {
        return ""
      };
      if ($truthy($rb_ge(total, 100))) {
        return " ＞ ファンブル"
      } else if ($truthy($rb_le(total, 1))) {
        return " ＞ 絶対成功(達成値1+SL)"
      } else if ($truthy($rb_le(total, target))) {
        
        dig10 = $rb_divide(total, 10).$floor();
        dig1 = $rb_minus(total, $rb_times(dig10, 10));
        if ($truthy($rb_ge(dig10, 10))) {
          dig10 = 0};
        if ($truthy($rb_ge(dig1, 10))) {
          dig1 = 0};
        if ($truthy($rb_le(dig1, 0))) {
          return " ＞ クリティカル(達成値20+SL)"
        } else {
          return "" + " ＞ 成功(達成値" + ($rb_plus(dig10, dig1)) + "+SL)"
        };
      } else {
        return " ＞ 失敗"
      };
    }, $Gundog_check_1D100$1.$$arity = 4);
    return (Opal.def(self, '$isD9', $Gundog_isD9$2 = function $$isD9() {
      var self = this;

      return true
    }, $Gundog_isD9$2.$$arity = 0), nil) && 'isD9';
  })($nesting[0], $$($nesting, 'DiceBot'), $nesting)
})(Opal);
