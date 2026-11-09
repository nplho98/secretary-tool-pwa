package io.github.nplho98.secretarytool;

import java.time.*;
import java.util.*;

/** 純時間規則；不依賴 Android，也不讀取網路。 */
public final class ReminderLogic {
    private ReminderLogic() {}
    public static Instant parseInstant(String value) {
        return OffsetDateTime.parse(value).toInstant();
    }
    public static final class Source {
        public String id, title, time;
        public String kind;
        public Set<Integer> weekdays = new HashSet<>();
        public Set<Integer> monthWeeks = new HashSet<>();
        public boolean enabled = true, done;
        public int lead = 10;
        public Instant updated, created, due;
    }
    public static final class Occurrence {
        public final String kind, sourceId, title;
        public final Instant occurs;
        public final int lead;
        public Occurrence(String kind, String sourceId, String title, Instant occurs, int lead) {
            this.kind=kind; this.sourceId=sourceId; this.title=title; this.occurs=occurs; this.lead=lead;
        }
        public Instant remindAt() { return occurs.minusSeconds(lead*60L); }
        public String key() { return kind+":"+sourceId+":"+occurs.toEpochMilli(); }
    }
    public static final class Decision {
        public final boolean ensure, soon, due;
        public final int minutes;
        Decision(boolean ensure, boolean soon, boolean due, int minutes) {
            this.ensure=ensure; this.soon=soon; this.due=due; this.minutes=minutes;
        }
    }
    public static boolean monthWeekMatches(LocalDate day, Set<Integer> monthWeeks) {
        if(monthWeeks==null || monthWeeks.isEmpty()) return true;
        return monthWeeks.contains((day.getDayOfMonth()-1)/7+1)
                || (monthWeeks.contains(-1) && day.getDayOfMonth()+7>day.lengthOfMonth());
    }
    public static List<Occurrence> occurrences(List<Source> sources, int todoLead, Instant now, ZoneId zone) {
        List<Occurrence> result = new ArrayList<>();
        LocalDate today=now.atZone(zone).toLocalDate();
        for(Source s:sources) {
            if("meeting".equals(s.kind)) {
                if(!s.enabled) continue;
                for(int offset=0;offset<2;offset++) {
                    LocalDate day=today.plusDays(offset);
                    if(!s.weekdays.contains(day.getDayOfWeek().getValue())) continue;
                    if(!monthWeekMatches(day,s.monthWeeks)) continue;
                    Instant occurs=day.atTime(LocalTime.parse(s.time)).atZone(zone).toInstant();
                    if(s.updated!=null && occurs.isBefore(s.updated)) continue;
                    result.add(new Occurrence(s.kind,s.id,s.title,occurs,s.lead));
                }
            } else if("todo".equals(s.kind) && !s.done && s.due!=null) {
                if(s.created!=null && s.due.isBefore(s.created)) continue;
                result.add(new Occurrence(s.kind,s.id,s.title,s.due,todoLead));
            }
        }
        return result;
    }
    public static Decision decide(Occurrence o, Instant now, ZoneId zone) {
        Instant remind=o.remindAt();
        boolean before=now.isBefore(o.occurs);
        boolean ensure=!now.isBefore(remind) && (o.occurs.atZone(zone).toLocalDate().equals(now.atZone(zone).toLocalDate()) || before);
        return new Decision(ensure,!now.isBefore(remind) && before && !now.isAfter(remind.plusSeconds(300)),
                !before && !now.isAfter(o.occurs.plusSeconds(300)),
                Math.max(1,(int)Math.floor((o.occurs.toEpochMilli()-now.toEpochMilli())/60000.0+0.5)));
    }
    public static Instant nextEvent(List<Occurrence> rows, Instant now, ZoneId zone) {
        // 日曆輪替時也重算，讓後天以後的週期會議進入今天／明天範圍。
        Instant next=now.atZone(zone).toLocalDate().plusDays(1).atStartOfDay(zone).toInstant();
        for(Occurrence o:rows) for(Instant event:Arrays.asList(o.remindAt(),o.occurs))
            if(event.isAfter(now) && event.isBefore(next)) next=event;
        return next;
    }
    public static String speech(Occurrence o, Decision d, boolean soon) {
        if("meeting".equals(o.kind)) return "老大，"+o.title+(soon?"再 "+d.minutes+" 分鐘開始。":"現在開始。");
        return soon?"老大，提醒您，待辦事項「"+o.title+"」再 "+d.minutes+" 分鐘就到期了。":
                "老大，待辦事項「"+o.title+"」時間到了，麻煩您處理一下。";
    }
}
