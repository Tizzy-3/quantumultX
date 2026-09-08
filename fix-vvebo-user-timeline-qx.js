let url = $request.url;

const hasUid = (url) => /[?&]uid=\d+/.test(url);

const getUid = (url) => {
  const match = url.match(/[?&]uid=(\d+)/);
  return match ? match[1] : undefined;
};

const uidKey = "vvebo_uid";

if (url.includes("remind/unread_count")) {
  const uid = getUid(url);

  if (uid) {
    $prefs.setValueForKey(uid, uidKey);
  }

  $done({});

} else if (url.includes("statuses/user_timeline")) {
  const uid = getUid(url) || $prefs.valueForKey(uidKey);

  if (!uid) {
    console.log("VVEBO: 未获取到 uid");
    $done({});
  } else {
    url = url
      .replace("statuses/user_timeline", "profile/statuses/tab")
      .replace("max_id", "since_id");

    if (!url.includes("containerid=")) {
      url += `&containerid=230413${uid}_-_WEIBO_SECOND_PROFILE_WEIBO`;
    }

    console.log(`VVEBO redirect: ${url}`);

    $done({ url });
  }

} else if (url.includes("profile/statuses/tab")) {
  try {
    const data = JSON.parse($response.body);

    const cards = Array.isArray(data.cards) ? data.cards : [];

    const statuses = cards
      .map(card => card.card_group ? card.card_group : card)
      .flat()
      .filter(card => card && card.card_type === 9 && card.mblog)
      .map(card => card.mblog)
      .map(status =>
        status.isTop
          ? { ...status, label: "置顶" }
          : status
      );

    const sinceId =
      data.cardlistInfo &&
      data.cardlistInfo.since_id;

    const body = JSON.stringify({
      statuses,
      since_id: sinceId,
      total_number: 100
    });

    $done({ body });

  } catch (e) {
    console.log(`VVEBO timeline error: ${e}`);
    $done({});
  }

} else {
  $done({});
}
