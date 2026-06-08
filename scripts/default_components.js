module.exports = {
  'component:image-block': {
    site: 'scp-wiki',
    page: 'component:image-block',
    source:
      '[[include :scp-wiki:component:image-block-base name={$name}|caption={$caption}|width={$width}|width=300px|link={$link}|link=#|align={$align}|align=right|alt={$alt}|alt-text={$alt-text}]]'
  },

  'component:image-block-base': {
    site: 'scp-wiki',
    page: 'component:image-block-base',
    source:
      '[[div class="scp-image-block block-{$align}" style="width:{$width};"]]\n' +
      '[[image {$name} alt="{$alt-text}" link={$link}]]\n' +
      '[[div class="scp-image-caption"]]\n' +
      '{$caption}\n' +
      '[[/div]]\n' +
      '[[/div]]'
  }
};