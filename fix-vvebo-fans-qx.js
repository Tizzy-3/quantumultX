const url = $request.url;

if (url.includes("selffans")) {
  try {
    const data = JSON.parse($response.body);

    const cards = Array.isArray(data.cards)
      ? data.cards.filter(card => card.itemid !== "INTEREST_PEOPLE2")
      : [];

    const body = JSON.stringify({
      ...data,
      cards
    });

    $done({ body });

  } catch (e) {
    console.log(`VVEBO fans error: ${e}`);
    $done({});
  }

} else {
  $done({});
}
