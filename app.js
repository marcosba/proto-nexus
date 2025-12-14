function app() {
  return {
    newBlogUrl: '',
    blogs: JSON.parse(localStorage.getItem('protoNexus_blogs') || '[]'),
    posts: [],
    
    async init() {
      await this.loadAllFeeds();
      setInterval(() => this.loadAllFeeds(), 30 * 60 * 1000);
    },
    
    async addBlog() {
      if (!this.newBlogUrl) return;
      
      let blogUrl = this.newBlogUrl.trim();
      if (!blogUrl.startsWith('http')) {
        blogUrl = `https://${blogUrl}`;
      }
      
      const feedUrl = await this.discoverFeed(blogUrl);
      
      if (feedUrl) {
        const blog = {
          id: Date.now(),
          url: blogUrl,
          feedUrl: feedUrl,
          title: blogUrl.replace('https://', '').replace('http://', '')
        };
        
        this.blogs.push(blog);
        this.saveBlogs();
        this.newBlogUrl = '';
        
        const newPosts = await this.fetchFeed(feedUrl);
        this.posts = [...newPosts, ...this.posts]
          .sort((a, b) => new Date(b.date) - new Date(a.date));
      } else {
        alert('No se pudo encontrar un feed RSS en ese blog');
      }
    },
    
    async discoverFeed(blogUrl) {
      const strategies = [
        // Estrategia 1: endpoints comunes
        async (url) => {
          const commonPaths = [
            '/feeds/posts/default',
            '/feeds/posts/default?alt=rss',
            '/feed',
            '/feed/',
            '/feed/rss',
            '/feed/rss/',
            '/feed/atom',
            '/rss',
            '/rss.xml',
            '/atom.xml',
            '/index.xml',
            '/index.rss',
            '/?feed=rss',
            '/blog/feed',
            '/posts/feed',
            '/feed.rss',
            '/.rss',
          ];
          
          for (const path of commonPaths) {
            const feedUrl = url + path;
            if (await this.testFeed(feedUrl)) {
              return feedUrl;
            }
          }
          return null;
        },
        
        // Estrategia 2: buscar <link> en HTML
        async (url) => {
          try {
            const proxyUrl = `https://tu-worker.rss-proxy.workers.dev/?url=${encodeURIComponent(url)}&mode=html`;
            const response = await fetch(proxyUrl);
            const html = await response.text();
            
            const regex = /<link[^>]+(?:type=["']application\/(?:rss|atom)\+xml["']|rel=["']alternate["'][^>]+type=["']application\/(?:rss|atom)\+xml["'])[^>]+href=["']([^"']+)["'][^>]*>/gi;
            let match;
            
            while ((match = regex.exec(html)) !== null) {
              const feedHref = match[1];
              const absoluteFeedUrl = new URL(feedHref, url).href;
              if (await this.testFeed(absoluteFeedUrl)) {
                return absoluteFeedUrl;
              }
            }
          } catch (error) {
            console.log('Error analizando HTML:', error);
          }
          return null;
        },
        
        // Estrategia 3: variaciones www
        async (url) => {
          const urlObj = new URL(url);
          const hostname = urlObj.hostname;
          const variations = [];
          
          if (hostname.startsWith('www.')) {
            variations.push(url.replace('www.', ''));
          } else {
            variations.push(url.replace('://', '://www.'));
          }
          
          for (const variation of variations) {
            const feedUrl = variation + '/feed';
            if (await this.testFeed(feedUrl)) {
              return feedUrl;
            }
          }
          return null;
        }
      ];
      
      const promises = strategies.map(strategy => strategy(blogUrl));
      const results = await Promise.all(promises);
      return results.find(result => result !== null) || null;
    },
    
    async testFeed(feedUrl) {
      try {
        const headResponse = await fetch(
          `https://tu-worker.rss-proxy.workers.dev/?url=${encodeURIComponent(feedUrl)}&mode=head`,
          { method: 'HEAD' }
        );
        
        if (!headResponse.ok) return false;
        
        const fullResponse = await fetch(
          `https://tu-worker.rss-proxy.workers.dev/?url=${encodeURIComponent(feedUrl)}`
        );
        const text = await fullResponse.text();
        
        return text.includes('<rss') || 
               text.includes('<feed') || 
               text.includes('<rdf:RDF') ||
               text.includes('application/rss+xml') ||
               text.includes('application/atom+xml');
      } catch (error) {
        return false;
      }
    },
    
    async fetchFeed(feedUrl) {
      try {
        const response = await fetch(
          `https://tu-worker.rss-proxy.workers.dev/?url=${encodeURIComponent(feedUrl)}`
        );
        const posts = await response.json();
        return posts.map(p => ({
          ...p,
          blogUrl: feedUrl.replace(/\/feed.*$/, '')
        }));
      } catch (error) {
        console.error('Error cargando feed:', feedUrl, error);
        return [];
      }
    },
    
    async loadAllFeeds() {
      if (this.blogs.length === 0) {
        this.posts = [];
        return;
      }
      
      const allPosts = [];
      for (const blog of this.blogs) {
        const posts = await this.fetchFeed(blog.feedUrl);
        allPosts.push(...posts);
      }
      
      this.posts = allPosts.sort((a, b) => new Date(b.date) - new Date(a.date));
    },
    
    unsubscribe(blogId) {
      this.blogs = this.blogs.filter(b => b.id !== blogId);
      this.saveBlogs();
      this.loadAllFeeds();
    },
    
    saveBlogs() {
      localStorage.setItem('protoNexus_blogs', JSON.stringify(this.blogs));
    }
  };
}